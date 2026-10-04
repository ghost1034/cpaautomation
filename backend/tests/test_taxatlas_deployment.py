from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def deployment_tools(tmp_path: Path):
    """Exercise the real shell entrypoints without contacting any cloud service."""
    log = tmp_path / "calls.jsonl"
    stub = f"""#!{sys.executable}
import json, os, sys
from pathlib import Path
args = sys.argv[1:]
with open(os.environ['DEPLOY_TEST_LOG'], 'a') as out:
    out.write(json.dumps([os.path.basename(sys.argv[0]), *args]) + '\\n')
if args[:1] == ['alpha']:
    args = args[1:]
elif args[:3] == ['monitoring', 'policies', 'list'] and '--help' in args:
    sys.exit(int(os.environ.get('DEPLOY_TEST_ALPHA_ONLY', '0')))
if args[:3] == ['run', 'jobs', 'execute'] and args[3] == 'taxatlas-seed':
    sys.exit(int(os.environ.get('DEPLOY_TEST_SEED_EXIT', '0')))
if args[:3] == ['scheduler', 'jobs', 'describe']:
    sys.exit(int(os.environ.get('DEPLOY_TEST_SCHEDULE_EXISTS', '0')))
if args[:2] == ['auth', 'list']:
    print('deployer@example.com')
if args[:3] == ['run', 'services', 'describe']:
    print('https://api.example.com')
if args[:2] == ['monitoring', 'policies'] and '--help' not in args:
    state_path = Path(os.environ['DEPLOY_TEST_LOG']).with_suffix('.policies.json')
    if state_path.exists():
        policies = json.loads(state_path.read_text())
    else:
        policies = {{}}
        for kind, hours in [('legacy', 'two'), ('invalid', '26'), ('current', '25')]:
            if kind not in os.environ.get('DEPLOY_TEST_ALERTS', '').split(','):
                continue
            name = 'projects/test-project/alertPolicies/' + kind
            policies[name] = {{
                'name': name,
                'displayName': 'TaxAtlas crawl success missing for ' + hours + ' hours',
                'enabled': os.environ.get('DEPLOY_TEST_ALERT_ENABLED') == '1',
                'notificationChannels': ['projects/test-project/notificationChannels/123'],
                'userLabels': {{'owner': 'taxatlas'}},
                'conditions': [{{'conditionAbsent': {{'duration': '7200s'}}}}],
            }}
    action = args[2]
    if action == 'list':
        for policy in policies.values():
            if '--format=value(displayName)' in args:
                print(policy['displayName'])
            elif '--filter=displayName="' + policy['displayName'] + '"' in args:
                print(policy['name'])
    elif action == 'describe':
        print(json.dumps(policies[args[3]]))
    elif action in ('create', 'update'):
        if '--no-enabled' in args:
            policies[args[3]]['enabled'] = False
        else:
            policy = next((json.loads(a.removeprefix('--policy=')) for a in args if a.startswith('--policy=')), None)
            if policy is not None:
                for condition in policy['conditions']:
                    absent = condition.get('conditionAbsent')
                    if absent and int(absent['duration'].removesuffix('s')) > 84600:
                        sys.exit('Metric absence durations longer than 23h30m are not supported')
                if os.environ.get('DEPLOY_TEST_POLICY_EXIT') == '1':
                    sys.exit('Policy update failed')
                for arg in args:
                    if arg.startswith('--notification-channels='):
                        policy['notificationChannels'] = arg.split('=', 1)[1].split(',')
                name = args[3] if action == 'update' else 'projects/test-project/alertPolicies/new'
                policies[name] = {{**policy, 'name': name}}
    state_path.write_text(json.dumps(policies))
"""
    for tool in ("gcloud", "docker"):
        executable = tmp_path / tool
        executable.write_text(stub)
        executable.chmod(0o755)
    env = {
        "PATH": f"{tmp_path}:{os.environ['PATH']}",
        "HOME": str(tmp_path),
        "DEPLOY_TEST_LOG": str(log),
        "PROJECT_ID": "test-project",
        "REGION": "us-central1",
        "HOSTED_CLAW_ENABLED": "false",
        "TAXATLAS_API_IMAGE": "registry/backend:test",
        "TAXATLAS_BROWSER_IMAGE": "registry/taxatlas-browser:test",
    }

    def run(script: str, *args: str, **overrides: str):
        result = subprocess.run(
            ["bash", str(ROOT / "scripts" / script), *args],
            cwd=ROOT,
            env={**env, **overrides},
            text=True,
            capture_output=True,
            timeout=30,
        )
        calls = [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []
        return result, calls

    return run


@pytest.mark.parametrize("schedule_exists", ["0", "1"])
def test_jobs_have_runtime_config_and_seed_before_schedules(deployment_tools, schedule_exists):
    result, calls = deployment_tools(
        "deploy-taxatlas-jobs.sh", DEPLOY_TEST_SCHEDULE_EXISTS=schedule_exists
    )
    assert result.returncode == 0, result.stderr
    jobs = [c for c in calls if c[1:4] == ["run", "jobs", "deploy"]]
    assert len(jobs) == 7
    for job in jobs:
        assert "--set-cloudsql-instances=test-project:us-central1:cpaautomation-db" in job
        assert "--vpc-connector=cpa-svpc" in job
        assert "--vpc-egress=private-ranges-only" in job
        assert "--set-secrets=DATABASE_URL=DATABASE_URL:latest,ENCRYPTION_KEY=ENCRYPTION_KEY:latest" in job
        assert "--tasks=1" in job and "--parallelism=1" in job
        assert any("TAXATLAS_PUBLIC_URL=https://cpaautomation.ai" in arg for arg in job)
    browser = next(c for c in jobs if c[4] == "taxatlas-crawl-browser")
    assert "--image=registry/taxatlas-browser:test" in browser
    assert "--memory=2Gi" in browser and "--cpu=2" in browser
    assert any("TAXATLAS_BROWSER_ENABLED=true" in arg for arg in browser)
    bindings = [c for c in calls if c[1:4] == ["run", "jobs", "add-iam-policy-binding"]]
    assert len(bindings) == 7
    seed = next(i for i, c in enumerate(calls) if c[1:5] == ["run", "jobs", "execute", "taxatlas-seed"])
    action = "update" if schedule_exists == "0" else "create"
    schedules = [(i, c) for i, c in enumerate(calls) if c[1:4] == ["scheduler", "jobs", action]]
    assert len(schedules) == 5
    assert all(i > seed for i, _ in schedules)
    assert all("--oauth-service-account-email=cpaautomation-runner@test-project.iam.gserviceaccount.com" in c for _, c in schedules)
    expected = {
        "taxatlas-crawl-hourly": "0 0 * * *",
        "taxatlas-news-six-hourly": "10 0 * * *",
        "taxatlas-browser-six-hourly": "25 0 * * *",
        "taxatlas-rate-watch-weekly": "40 3 * * *",
        "taxatlas-dispatch-minute": "* * * * *",
    }
    assert {c[5] for _, c in schedules} == set(expected)
    for _, command in schedules:
        assert f"--schedule={expected[command[5]]}" in command
        assert "--time-zone=UTC" in command
    policy = crawl_success_policy(calls)
    assert_daily_success_condition(policy)


def crawl_success_policy(calls):
    return next(
        json.loads(arg.removeprefix("--policy="))
        for call in calls for arg in call if arg.startswith("--policy=")
    )


def assert_daily_success_condition(policy):
    assert policy["displayName"] == "TaxAtlas crawl success missing for 25 hours"
    assert len(policy["conditions"]) == 1
    condition = policy["conditions"][0]
    assert "conditionAbsent" not in condition
    promql = condition["conditionPrometheusQueryLanguage"]
    assert promql["duration"] == "0s"
    assert promql["evaluationInterval"] == "300s"
    assert promql["disableMetricValidation"] is True
    assert promql["query"] == (
        '(sum(sum_over_time(logging_googleapis_com:user_taxatlas_crawl_successes'
        '{monitored_resource="cloud_run_job",project_id="test-project"}[25h])) or vector(0)) == 0'
    )


@pytest.mark.parametrize("existing,selected", [
    ("legacy", "legacy"),
    ("invalid", "invalid"),
    ("current", "current"),
    ("legacy,invalid", "invalid"),
    ("legacy,invalid,current", "current"),
])
@pytest.mark.parametrize("enabled", ["0", "1"])
def test_daily_deploy_migrates_old_alert_without_losing_channels_or_enabled_state(
    deployment_tools, existing, selected, enabled
):
    result, calls = deployment_tools(
        "../infra/taxatlas/configure-monitoring.sh",
        DEPLOY_TEST_ALERTS=existing, DEPLOY_TEST_ALERT_ENABLED=enabled,
    )
    assert result.returncode == 0, result.stderr
    updates = [c for c in calls if c[1:4] == ["monitoring", "policies", "update"]]
    assert updates[0][4] == f"projects/test-project/alertPolicies/{selected}"
    policy = crawl_success_policy(calls)
    assert_daily_success_condition(policy)
    assert policy["notificationChannels"] == ["projects/test-project/notificationChannels/123"]
    assert policy["enabled"] is (enabled == "1")
    assert policy["userLabels"] == {"owner": "taxatlas"}
    assert {c[4].rsplit("/", 1)[-1] for c in updates[1:]} == set(existing.split(",")) - {selected}
    assert all("--no-enabled" in c for c in updates[1:])
    assert not any("--if=absent" in c for c in calls)


@pytest.mark.parametrize("alpha_only", ["0", "1"])
def test_monitoring_creates_daily_alert_with_channels_and_reruns_without_duplicates(
    deployment_tools, alpha_only
):
    channels = "projects/test-project/notificationChannels/456"
    result, calls = deployment_tools(
        "../infra/taxatlas/configure-monitoring.sh",
        TAXATLAS_NOTIFICATION_CHANNELS=channels, DEPLOY_TEST_ALPHA_ONLY=alpha_only,
    )
    assert result.returncode == 0, result.stderr
    policy = crawl_success_policy(calls)
    assert_daily_success_condition(policy)
    assert policy["enabled"] is True
    create = next(c for c in calls if any(a.startswith("--policy=") for a in c))
    assert "create" in create
    assert f"--notification-channels={channels}" in create
    result, calls = deployment_tools(
        "../infra/taxatlas/configure-monitoring.sh", DEPLOY_TEST_ALPHA_ONLY=alpha_only
    )
    assert result.returncode == 0, result.stderr
    policy_calls = [c for c in calls if any(a.startswith("--policy=") for a in c)]
    assert len(policy_calls) == 2
    assert "update" in policy_calls[1]
    assert "projects/test-project/alertPolicies/new" in policy_calls[1]
    updated_policy = crawl_success_policy(policy_calls[1:])
    assert_daily_success_condition(updated_policy)
    assert updated_policy["notificationChannels"] == [channels]


def test_monitoring_keeps_old_alerts_if_replacement_fails(deployment_tools):
    result, calls = deployment_tools(
        "../infra/taxatlas/configure-monitoring.sh",
        DEPLOY_TEST_ALERTS="legacy,current", DEPLOY_TEST_POLICY_EXIT="1",
    )
    assert result.returncode != 0
    assert not any("--no-enabled" in c for c in calls)


def test_failed_seed_does_not_activate_schedules(deployment_tools):
    result, calls = deployment_tools("deploy-taxatlas-jobs.sh", DEPLOY_TEST_SEED_EXIT="1")
    assert result.returncode != 0
    assert not any(c[1:3] == ["scheduler", "jobs"] for c in calls)


def test_job_deploy_preserves_explicit_shared_runtime_configuration(deployment_tools):
    key = "projects/test-project/locations/us-central1/keyRings/shared/cryptoKeys/tokens"
    secrets = "DATABASE_URL=DATABASE_URL:latest,ENCRYPTION_KEY=ENCRYPTION_KEY:latest,TAXATLAS_SMTP_PASSWORD=SMTP:latest"
    result, calls = deployment_tools(
        "deploy-taxatlas-jobs.sh", KMS_KEY_RESOURCE_NAME=key,
        TAXATLAS_JOB_SECRETS=secrets, VPC_CONNECTOR="custom-vpc",
        TAXATLAS_PUBLIC_URL="https://custom.example.com",
    )
    assert result.returncode == 0, result.stderr
    jobs = [c for c in calls if c[1:4] == ["run", "jobs", "deploy"]]
    for job in jobs:
        assert f"--set-secrets={secrets}" in job
        assert "--vpc-connector=custom-vpc" in job
        assert any(f"KMS_KEY_RESOURCE_NAME={key}" in arg for arg in job)
        assert any("TAXATLAS_PUBLIC_URL=https://custom.example.com" in arg for arg in job)


@pytest.mark.parametrize("target,environment", [
    ((), "production"),
    (("--backend-only",), "production"),
    (("--frontend-only",), "production"),
    (("--backend-only",), "staging"),
])
def test_standard_deploy_skips_taxatlas(deployment_tools, target, environment):
    result, calls = deployment_tools(
        "deploy-services.sh", *target, "--skip-build", "--environment", environment,
    )
    assert result.returncode == 0, result.stderr
    assert not any("taxatlas" in arg.lower() for call in calls for arg in call)
    if target != ("--frontend-only",):
        assert any(c[1:4] == ["run", "jobs", "execute"] for c in calls)


@pytest.mark.parametrize("skip_build", [False, True])
@pytest.mark.parametrize("skip_migrate", [False, True])
def test_opted_in_deploy_includes_jobs_after_migration(
    deployment_tools, skip_build, skip_migrate
):
    options = ["--with-taxatlas", "--backend-only"]
    if skip_build:
        options.append("--skip-build")
    if skip_migrate:
        options.append("--skip-migrate")
    result, calls = deployment_tools(
        "deploy-services.sh", "release-test", "production", *options,
    )
    assert result.returncode == 0, result.stderr
    jobs = [(i, c) for i, c in enumerate(calls) if c[1:4] == ["run", "jobs", "deploy"]]
    assert len(jobs) == 7
    if not skip_migrate:
        migration = next(i for i, c in enumerate(calls) if c[1:5] == ["run", "jobs", "execute", "cpa-migrate"])
        assert all(i > migration for i, _ in jobs)
    else:
        assert not any("cpa-migrate" in c for c in calls)
    browser = next(c for _, c in jobs if c[4] == "taxatlas-crawl-browser")
    assert "--image=us-central1-docker.pkg.dev/test-project/cpa-docker/taxatlas-browser:release-test" in browser
    builds = [c for c in calls if c[:3] == ["docker", "buildx", "build"]]
    assert len(builds) == (0 if skip_build else 2)
    if not skip_build:
        assert any("backend/Dockerfile.taxatlas-browser" in c for c in builds)


@pytest.mark.parametrize("with_taxatlas", [False, True])
def test_backend_build_includes_browser_image_only_when_requested(deployment_tools, with_taxatlas):
    options = ["--with-taxatlas"] if with_taxatlas else []
    result, calls = deployment_tools("build-images.sh", "release-test", "--backend-only", *options)
    assert result.returncode == 0, result.stderr
    builds = [c for c in calls if c[:3] == ["docker", "buildx", "build"]]
    assert len(builds) == (2 if with_taxatlas else 1)
    assert any("backend/Dockerfile.taxatlas-browser" in c for c in builds) is with_taxatlas
    assert all("linux/amd64" in c for c in builds)


@pytest.mark.parametrize("mode", [(), ("--build-only",), ("--deploy-only",)])
@pytest.mark.parametrize("with_taxatlas", [False, True])
def test_main_deploy_forwards_taxatlas_opt_in_to_build_and_deploy(deployment_tools, mode, with_taxatlas):
    options = ["--with-taxatlas"] if with_taxatlas else []
    result, calls = deployment_tools("deploy.sh", "--backend-only", *mode, *options)
    assert result.returncode == 0, result.stderr
    builds = [c for c in calls if c[:3] == ["docker", "buildx", "build"]]
    jobs = [c for c in calls if c[1:4] == ["run", "jobs", "deploy"]]
    assert any("backend/Dockerfile.taxatlas-browser" in c for c in builds) is (
        with_taxatlas and mode != ("--deploy-only",)
    )
    assert len(jobs) == (7 if with_taxatlas and mode != ("--build-only",) else 0)
    if mode == ("--deploy-only",):
        assert not builds
    if mode == ("--build-only",):
        assert not any(c[1:3] == ["run", "jobs"] for c in calls)
        if with_taxatlas:
            assert "--deploy-only --backend-only --with-taxatlas" in result.stdout
    if not with_taxatlas:
        assert not any("taxatlas" in arg.lower() for call in calls for arg in call)


@pytest.mark.parametrize("script,options", [
    ("deploy.sh", ("--frontend-only",)),
    ("deploy.sh", ("--staging",)),
    ("deploy-services.sh", ("--frontend-only",)),
    ("deploy-services.sh", ("--environment", "staging")),
    ("deploy-services.sh", ("release-test", "staging")),
    ("build-images.sh", ("--frontend-only",)),
])
def test_taxatlas_rejects_incompatible_targets_before_cloud_calls(deployment_tools, script, options):
    result, calls = deployment_tools(script, *options, "--with-taxatlas")
    assert result.returncode != 0
    assert "--with-taxatlas requires" in result.stdout
    assert not calls


@pytest.mark.parametrize("script", ["deploy.sh", "deploy-services.sh", "build-images.sh"])
def test_help_documents_taxatlas_opt_in_without_cloud_calls(deployment_tools, script):
    result, calls = deployment_tools(script, "--help")
    assert result.returncode == 0, result.stderr
    assert "--with-taxatlas" in result.stdout
    assert not calls

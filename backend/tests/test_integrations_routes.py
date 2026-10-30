from fastapi import FastAPI

from routes.integrations import router


def test_gmail_attachments_limit_is_capped_at_100():
    app = FastAPI()
    app.include_router(router)

    operation = next(
        path_item["get"]
        for path, path_item in app.openapi()["paths"].items()
        if path.endswith("/gmail/attachments") and "get" in path_item
    )
    limit = next(param for param in operation["parameters"] if param["name"] == "limit")

    assert limit["schema"]["maximum"] == 100

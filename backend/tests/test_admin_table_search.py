from sqlalchemy import Column, Integer, LargeBinary, MetaData, String, Table, create_engine, func, select

from routes.admin import _table_search_clause


def _setup():
    metadata = MetaData()
    table = Table(
        "search_fixture",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("name", String),
        Column("password", String),
        Column("blob", LargeBinary),
    )
    engine = create_engine("sqlite://")
    metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(table.insert(), [
            {"id": 1, "name": "Quarterly packet", "password": "hunter2", "blob": b"x"},
            {"id": 2, "name": "100% complete", "password": "quarterly", "blob": None},
            {"id": 3, "name": "draft_v2", "password": None, "blob": None},
        ])
        connection.execute(table.insert(), [{"id": 100 + i, "name": f"row {i}"} for i in range(60)])
    return engine, table


def _matching_ids(engine, table, search):
    with engine.connect() as connection:
        return sorted(connection.execute(select(table.c.id).where(_table_search_clause(table, search))).scalars())


def test_table_search_matches_any_visible_column_case_insensitively():
    engine, table = _setup()
    assert _matching_ids(engine, table, "QUARTERLY") == [1]
    assert _matching_ids(engine, table, "Draft") == [3]


def test_table_search_ignores_redacted_columns():
    engine, table = _setup()
    assert _matching_ids(engine, table, "hunter2") == []


def test_table_search_treats_like_wildcards_literally():
    engine, table = _setup()
    assert _matching_ids(engine, table, "%") == [2]
    assert _matching_ids(engine, table, "_v") == [3]


def test_table_search_covers_rows_beyond_first_page():
    engine, table = _setup()
    with engine.connect() as connection:
        count = connection.execute(select(func.count()).select_from(table).where(_table_search_clause(table, "row 59"))).scalar_one()
    assert count == 1

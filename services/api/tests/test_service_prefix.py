from fastapi.testclient import TestClient

from app.config import settings
from app.main import app


def test_hosted_prefix_and_standalone_routes_share_the_same_contract():
    with TestClient(app) as client:
        standalone = client.get("/v1/geocode", params={"q": "Upper West Side"})
        hosted = client.get("/api/v1/geocode", params={"q": "Upper West Side"})

    assert standalone.status_code == 200
    assert hosted.status_code == 200
    assert hosted.json() == standalone.json()


def test_hosted_health_reports_fixture_storage():
    with TestClient(app) as client:
        response = client.get("/api/healthz")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "database": "postgres" if settings.database_url else "memory",
        "fixture_mode": True,
        "sharing_enabled": bool(settings.database_url and settings.share_signing_secret),
    }


def test_hosted_docs_use_the_prefixed_openapi_url():
    with TestClient(app) as client:
        docs = client.get("/api/docs")
        schema = client.get("/api/openapi.json")

    assert docs.status_code == 200
    assert "url: '/api/openapi.json'" in docs.text
    assert schema.status_code == 200
    assert schema.json()["info"]["title"] == "NYC Discover API"

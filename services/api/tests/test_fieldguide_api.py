import base64
import hashlib
import hmac
import json
from copy import deepcopy
from datetime import datetime, timedelta
from unittest.mock import AsyncMock
from zoneinfo import ZoneInfo

import pytest

from app.main import app
from app.domain import PlaceDetails
from app.limits import ProviderBusyError
from app.schemas import CoordinatesSchema, GenerateRequest, GenerationResponse
from app.sharing import verify_generation
from test_options import candidate
from test_options_api import client
from test_launch_security import brief as old_brief, generation as old_generation

NYC = ZoneInfo('America/New_York')
NOW = datetime(2026, 9, 26, 12, tzinfo=NYC)


@pytest.fixture
def guide(client, monkeypatch):
    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return NOW.astimezone(tz) if tz else NOW
    monkeypatch.setattr('app.main.datetime', Clock)
    catalog = [candidate(f'p{i}', category, details=PlaceDetails(description=f'A distinct {category} stop.',
        activity='Take a closer look.', price_status='free', source_urls=('https://example.org/visit',)))
        for i, category in enumerate(['museum','library','gallery','park','bookstore','landmark','cafe','restaurant'])]
    provider = AsyncMock(return_value=(catalog, ()))
    monkeypatch.setattr(app.state.providers, 'candidates', provider)
    brief = old_brief().model_copy(update=dict(start_at=NOW, budget_min=0, budget_max=40,
        coordinates=CoordinatesSchema(latitude=40.787, longitude=-73.9754), seen_candidate_ids=['private-seen'],
        visited_candidate_ids=['private-visited'], excluded_candidate_ids=['private-dismissed']))
    return client, json.loads(brief.model_dump_json()), catalog, provider


def test_discovery_generation_signed_remix_outing_and_share(guide):
    client, brief, catalog, provider = guide
    cards = client.post('/v1/discovery/today', json=brief)
    assert cards.status_code == 200, cards.text
    assert cards.json()['data_mode'] == 'fixture'
    anchor = cards.json()['cards'][0]['step']['candidate_id']
    brief.update(centerpiece_id=anchor, locked_candidate_ids=[anchor])
    generated = client.post('/v1/itineraries/generate', json=brief)
    assert generated.status_code == 200, generated.text
    generation = generated.json()
    assert all(anchor in [s['candidate_id'] for s in p['steps']] for p in generation['plans'])
    payload = dict(brief=brief, generation=generation, swap_token=generation['swap_token'], plan_id='plan-1',
        locked_candidate_ids=[anchor], seen_candidate_ids=[s['candidate_id'] for p in generation['plans'] for s in p['steps']])
    response = client.post('/v1/itineraries/remix', json=payload)
    assert response.status_code == 200, response.text
    assert provider.await_count == 3  # Discovery, generation, and a fresh remix lookup.
    changed = response.json()
    first = changed['generation']['plans'][0]['steps'][0]
    payload.update(brief=changed['brief'], generation=changed['generation'], swap_token=changed['generation']['swap_token'],
        continue_outing=True, completed_candidate_ids=[first['candidate_id']],
        current_coordinates={'latitude':40.787,'longitude':-73.9754}, current_location_label='Private sidewalk starting point')
    response = client.post('/v1/itineraries/remix', json=payload)
    assert response.status_code == 200, response.text
    changed = response.json()
    assert all(p['steps'][0] == first for p in changed['generation']['plans'])
    share = client.post('/v1/shares', json=dict(brief=changed['brief'], generation=changed['generation'],
        snapshot_token=changed['generation']['snapshot_token'], selected_plan_id='plan-1'))
    assert share.status_code == 201, share.text
    shared = client.get(f"/v1/shares/{share.json()['id']}")
    assert shared.status_code == 200
    for private in ['Private sidewalk', 'Secret Street', 'private-seen', 'private-visited', 'private-dismissed',
                    'completed_candidate_ids', 'seen_candidate_ids', 'discovery_mode']:
        assert private not in shared.text
    assert shared.json()['generation']['candidate_context'] is None


def test_remix_rejects_tampering_unavailable_locks_and_exhausted_pool(guide):
    client, brief, catalog, provider = guide
    generation = client.post('/v1/itineraries/generate', json=brief).json()
    payload = dict(brief=brief, generation=generation, swap_token=generation['swap_token'], plan_id='plan-1')
    tampered = deepcopy(payload)
    tampered['generation']['plans'][0]['title'] = 'Tampered editorial copy'
    assert client.post('/v1/itineraries/remix', json=tampered).status_code == 400
    lock = generation['plans'][0]['steps'][0]['candidate_id']
    provider.return_value = ([c for c in catalog if c.id != lock], ())
    result = client.post('/v1/itineraries/remix', json={**payload, 'locked_candidate_ids':[lock]})
    assert result.status_code == 422 and 'Unlock' in result.text
    result = client.post('/v1/itineraries/remix', json={**payload, 'excluded_candidate_ids':[c.id for c in catalog]})
    assert result.status_code == 422 and 'current plan is unchanged' in result.text


def test_unavailable_provider_and_wrong_nyc_date(guide):
    client, brief, _, provider = guide
    provider.side_effect = ProviderBusyError('Busy')
    assert client.post('/v1/discovery/today', json=brief).status_code == 503
    tomorrow = {**brief, 'start_at': '2026-09-27T01:00:00-04:00'}
    assert client.post('/v1/discovery/today', json=tomorrow).status_code == 422


def test_pre_fieldguide_signatures_still_verify(monkeypatch):
    # Build the bytes using the old contract, independently of the new signer.
    brief = old_brief().model_dump(mode='json')
    generation = old_generation().model_dump(mode='json')
    for key in ['centerpiece_id','discovery_mode','seen_candidate_ids','visited_candidate_ids','excluded_candidate_ids','locked_candidate_ids']:
        brief.pop(key)
    generation.pop('swap_token'); generation.pop('candidate_context')
    generation['weather'].pop('periods'); generation['weather'].pop('assumed')
    for plan in generation['plans']:
        for key in ['additional_options','introduction','why_today','prompt','character']:
            plan.pop(key)
        for step in plan['steps']:
            step.pop('details'); step.pop('why_today')
            step.pop('schedule_kind'); step.pop('window_start_at'); step.pop('window_end_at')
    canonical = json.dumps({'brief':brief, 'generation':generation}, sort_keys=True, separators=(',',':')).encode()
    timestamp = 2_000_000_000
    signature = hmac.new(b'legacy-secret', str(timestamp).encode()+b'.'+canonical, hashlib.sha256).digest()
    token = f'{timestamp}.'+base64.urlsafe_b64encode(signature).decode().rstrip('=')
    monkeypatch.setattr('app.sharing.time.time', lambda: timestamp+10)
    assert verify_generation(GenerateRequest.model_validate(brief), GenerationResponse.model_validate(generation), token, 'legacy-secret')

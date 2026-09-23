"""Discovery cards and signed itinerary remixing share the same constraint engine."""
from dataclasses import asdict, replace
from datetime import datetime

from .domain import Candidate, ItineraryInput, WeatherContext
from .engine import _candidate_is_possible, _empty_beam, _extend_beam, candidate_score, generate_itineraries, FOOD_DRINK_CATEGORIES, allows_multiple_food_stops
from .editorial import plan_copy
from .options import itinerary_input, _step
from .time_math import add_minutes, elapsed_minutes, outing_deadline
from .schemas import DiscoveryCard, DiscoveryResponse, GenerationResponse, RemixRequest, RemixResponse


def discovery_response(brief: ItineraryInput, candidates: list[Candidate], weather: WeatherContext,
                       warnings: tuple[str, ...], fixture: bool) -> DiscoveryResponse:
    possible = []
    for candidate in candidates:
        if not _candidate_is_possible(candidate, brief, weather):
            continue
        beam = _extend_beam(_empty_beam(brief), candidate, brief, weather)
        if beam:
            possible.append((candidate, beam.steps[0]))
    possible.sort(key=lambda pair: (-candidate_score(pair[0], brief, weather), pair[0].id))
    cards = []
    selected = set()
    predicates = [
        ('Starting soon', lambda c: c.schedule_kind == 'fixed_start' and c.start_at is not None and
         brief.start_at.timestamp() <= c.start_at.timestamp() <= add_minutes(brief.start_at, 120).timestamp()),
        ('Something free', lambda c: c.details is not None and c.details.price_status == 'free' and c.cost_high == 0),
        ('Worth a little detour', lambda c: c.details is not None and bool(c.details.description)),
    ]
    for label, predicate in predicates:
        pair = next((pair for pair in possible if pair[0].id not in selected and predicate(pair[0])), None)
        if pair:
            selected.add(pair[0].id)
            cards.append(DiscoveryCard(label=label, step=asdict(pair[1])))
    if not cards:
        cards = [DiscoveryCard(label='Around the neighborhood', step=asdict(s)) for _, s in possible[:3]]
    return DiscoveryResponse(cards=cards, weather=asdict(weather), warnings=list(warnings),
                             generated_at=datetime.now(brief.start_at.tzinfo), data_mode='fixture' if fixture else 'live')


def remix_inputs(payload: RemixRequest, now: datetime):
    plan = next((p for p in payload.generation.plans if p.id == payload.plan_id), None)
    if plan is None:
        raise ValueError('Choose a plan to remix.')
    ids = [s.candidate_id for s in plan.steps]
    completed = payload.completed_candidate_ids
    if completed != ids[:len(completed)] or len(set(completed)) != len(completed):
        raise ValueError('Complete stops in itinerary order.')
    if not set(payload.locked_candidate_ids).issubset(ids):
        raise ValueError('Only stops in this plan can be kept.')
    if completed and not payload.continue_outing:
        raise ValueError('Use the outing view to change the remaining stops.')
    changes = dict(discovery_mode=payload.discovery_mode, seen_candidate_ids=payload.seen_candidate_ids,
                   visited_candidate_ids=payload.visited_candidate_ids, excluded_candidate_ids=payload.excluded_candidate_ids,
                   locked_candidate_ids=payload.locked_candidate_ids, regeneration_seed=(payload.brief.regeneration_seed + 1) % 1_000_001)
    if payload.continue_outing and payload.current_coordinates:
        changes.update(coordinates=payload.current_coordinates, location_label=payload.current_location_label or 'Current stop')
    elif payload.continue_outing and completed:
        changes.update(coordinates=plan.steps[len(completed)-1].coordinates, location_label=plan.steps[len(completed)-1].name)
    # A centerpiece may be released explicitly by unlocking it in the client.
    changes['centerpiece_id'] = payload.brief.centerpiece_id if payload.brief.centerpiece_id in payload.locked_candidate_ids else None
    effective = payload.brief.model_copy(update=changes)
    request = itinerary_input(effective)
    if request.start_at.date() != now.date():
        raise ValueError('This outing belongs to another day. Make a plan for today.')
    prefix = tuple(plan.steps[:len(completed)])
    if payload.continue_outing:
        deadline = outing_deadline(request.start_at, request.available_minutes)
        # Completion keeps the signed stop times intact, even if marked early.
        now = max(now, prefix[-1].end_at, key=lambda value: value.timestamp()) if prefix else now
        minutes = elapsed_minutes(now, deadline)
        if minutes <= 0 or len(prefix) >= 3:
            raise ValueError('There is no time remaining in this outing.')
        request = replace(request, start_at=now, available_minutes=minutes,
                          budget_max=max(0, request.budget_max - sum(s.cost_high for s in prefix)), budget_min=0,
                          locked_candidate_ids=tuple(i for i in request.locked_candidate_ids if i not in completed),
                          centerpiece_id=None if request.centerpiece_id in completed else request.centerpiece_id,
                          excluded_candidate_ids=tuple(set(request.excluded_candidate_ids) | set(completed)))
    else:
        # Now-based plans must still be reachable when the user asks for another idea.
        if request.start_at.timestamp() < now.timestamp():
            deadline = outing_deadline(request.start_at, request.available_minutes)
            remaining = elapsed_minutes(now, deadline)
            if remaining < 60:
                raise ValueError('Use Start this outing to replan the remaining time, or make a new brief.')
            effective = effective.model_copy(update=dict(start_at=now, available_minutes=remaining))
            request = itinerary_input(effective)
    return effective, request, prefix


def remixed_response(payload: RemixRequest, effective, request, prefix, candidates, weather, warnings):
    if prefix and not allows_multiple_food_stops(request) and any(s.category in FOOD_DRINK_CATEGORIES for s in prefix):
        candidates = [c for c in candidates if c.category not in FOOD_DRINK_CATEGORIES]
    result = generate_itineraries(request, candidates, weather, warnings, max_stops=3-len(prefix))
    if not result.plans:
        raise ValueError('No alternative fits the remaining time and budget. Your current plan is unchanged.')
    response = GenerationResponse.model_validate(dict(weather=asdict(weather), plans=[asdict(p) for p in result.plans],
        warnings=list(result.warnings), generated_at=result.generated_at, data_mode=payload.generation.data_mode,
        candidate_context=[asdict(c) for c in result.candidate_context]))
    if prefix:
        for plan in response.plans:
            plan.steps = [*prefix, *plan.steps]
            plan.total_cost_low += sum(s.cost_low for s in prefix)
            plan.total_cost_high += sum(s.cost_high for s in prefix)
            plan.total_minutes = elapsed_minutes(itinerary_input(effective).start_at, plan.steps[-1].end_at)
            plan.additional_options = []
            title, introduction, character, prompt = plan_copy(tuple(_step(step) for step in plan.steps))
            plan.title, plan.introduction, plan.character, plan.prompt = title, introduction, character, prompt
            plan.why_today = next((step.why_today for step in plan.steps if step.why_today), None)
    return RemixResponse(brief=effective, generation=response)

"""Small, factual templates. Never turn missing evidence into a claim."""
from dataclasses import replace
from datetime import datetime

from .domain import Candidate, PlaceDetails, TimelineStep, TodayReason, WeatherContext


def weather_during(weather: WeatherContext, start: datetime, end: datetime) -> tuple[int, bool]:
    periods = [p for p in weather.periods if p.start_at.timestamp() < end.timestamp() and p.end_at.timestamp() > start.timestamp()]
    if periods:
        return max(p.precipitation_probability for p in periods), any(p.is_severe for p in periods)
    return weather.precipitation_probability, weather.is_severe


def forecast_covers(weather: WeatherContext, start: datetime, end: datetime) -> bool:
    covered_until = start
    for period in sorted(weather.periods, key=lambda p: p.start_at.timestamp()):
        if period.end_at.timestamp() <= covered_until.timestamp():
            continue
        if period.start_at.timestamp() > covered_until.timestamp():
            return False
        covered_until = period.end_at
        if covered_until.timestamp() >= end.timestamp():
            return True
    return False


def today_reason(candidate: Candidate, start: datetime, end: datetime, weather: WeatherContext) -> TodayReason | None:
    if candidate.final_day == start.date().isoformat():
        return TodayReason("final_day", "The final day of this run.", candidate.source_url)
    if candidate.start_at:
        if candidate.recurrence == "one_off":
            return TodayReason("one_off", "A one-off happening on today's calendar.", candidate.source_url)
        if candidate.recurrence == "recurring":
            return TodayReason("recurring", "Today is one of its scheduled days.", candidate.source_url)
        return TodayReason("scheduled", "On the calendar today.", candidate.source_url)
    rain, severe = weather_during(weather, start, end)
    # A neutral fallback forecast is not evidence of good weather.
    if not weather.assumed and forecast_covers(weather, start, end) and candidate.indoor is False and rain < 30 and not severe:
        return TodayReason("weather", "Low rain chances during this outdoor stop.", "https://www.weather.gov/nyc/")
    return None


ACTIVITIES = {
    "museum": "Take your time with one gallery before exploring the rest.",
    "gallery": "Choose one work to look at a little longer.",
    "park": "Leave a little room for a slow walk and a pause.",
    "bookstore": "Browse a shelf you would usually walk past.",
    "library": "Find a quiet corner and something new to read.",
    "restaurant": "Make time for a meal along the way.",
    "cafe": "Take a coffee break and settle in for a moment.",
    "bar": "Settle in for a drink and conversation.",
    "market": "Browse the stalls; purchases are optional.",
    "landmark": "Pause for a closer look at the place and its surroundings.",
    "music": "Settle in and listen to the scheduled performance.",
    "comedy": "Catch the scheduled show and leave a little room for laughter.",
    "trivia": "Join the trivia session and try a round together.",
    "dessert": "Leave time for something sweet along the way.",
    "event": "Join the activity described in the organizer's listing.",
}


def activity_details(candidate: Candidate) -> PlaceDetails:
    details = candidate.details or PlaceDetails()
    if details.activity:
        return details
    return replace(details, activity=ACTIVITIES.get(candidate.category, "Take a little time to explore this stop."))


def plan_copy(steps: tuple[TimelineStep, ...]) -> tuple[str, str, str, str | None]:
    categories = {s.category for s in steps}
    phrases = {"museum": "a little art", "gallery": "a little art", "park": "some fresh air",
               "bookstore": "a good browse", "library": "a quiet page", "restaurant": "a good bite",
               "cafe": "a coffee break", "music": "a live set", "comedy": "a few laughs",
               "trivia": "a little friendly competition", "dessert": "something sweet", "market": "a market wander",
               "landmark": "a closer look", "event": "something happening", "bar": "a drink together"}
    first = phrases.get(steps[0].category, "a neighborhood discovery")
    last = phrases.get(steps[-1].category, "a local detour")
    title = (first if len(steps) == 1 else f"{first}, then {last}").capitalize()
    intro = (f"Start with {steps[0].name}, then make your way to {steps[-1].name}."
             if len(steps) > 1 else f"Make time for {steps[0].name} today.")
    character = "Happening today" if any(s.why_today and s.why_today.kind != "weather" for s in steps) else (
        "Fresh air" if "park" in categories else "A local discovery")
    prompt = next((s.details.prompt for s in steps if s.details and s.details.prompt), None)
    return title, intro, character, prompt

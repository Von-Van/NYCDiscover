from __future__ import annotations

import re
from dataclasses import dataclass

from .domain import Coordinates


@dataclass(frozen=True, slots=True)
class Area:
    name: str
    coordinates: Coordinates
    aliases: tuple[str, ...] = ()
    is_borough: bool = False


# Hand-entered centroids for the areas that show up in event listings without a
# mappable street address. They are deliberately coarse: a centroid puts an event
# in the right neighborhood, not at the right door, and anything placed with one
# is marked approximate so the plan says so.
NYC_AREAS: tuple[Area, ...] = (
    # Boroughs, matched only when nothing more specific is named.
    Area("Manhattan", Coordinates(40.7831, -73.9712), is_borough=True),
    Area("Brooklyn", Coordinates(40.6782, -73.9442), is_borough=True),
    Area("Queens", Coordinates(40.7282, -73.7949), is_borough=True),
    Area("The Bronx", Coordinates(40.8448, -73.8648), aliases=("bronx",), is_borough=True),
    Area("Staten Island", Coordinates(40.5795, -74.1502), is_borough=True),
    # Manhattan
    Area("Financial District", Coordinates(40.7075, -74.0113), aliases=("fidi",)),
    Area("Battery Park City", Coordinates(40.7115, -74.0161)),
    Area("Tribeca", Coordinates(40.7163, -74.0086)),
    Area("Soho", Coordinates(40.7233, -74.0030)),
    Area("Chinatown", Coordinates(40.7158, -73.9970)),
    Area("Lower East Side", Coordinates(40.7150, -73.9843), aliases=("les",)),
    Area("East Village", Coordinates(40.7265, -73.9815)),
    Area("Greenwich Village", Coordinates(40.7336, -74.0027), aliases=("west village",)),
    Area("Washington Square Park", Coordinates(40.7308, -73.9973)),
    Area("Union Square", Coordinates(40.7359, -73.9911)),
    Area("Chelsea", Coordinates(40.7465, -74.0014)),
    Area("Flatiron", Coordinates(40.7401, -73.9903)),
    Area("Gramercy", Coordinates(40.7368, -73.9845)),
    Area("Madison Square Park", Coordinates(40.7420, -73.9880)),
    Area("Midtown", Coordinates(40.7549, -73.9840)),
    Area("Times Square", Coordinates(40.7580, -73.9855)),
    Area("Bryant Park", Coordinates(40.7536, -73.9832)),
    Area("Rockefeller Center", Coordinates(40.7587, -73.9787)),
    Area("Hell's Kitchen", Coordinates(40.7638, -73.9918), aliases=("clinton",)),
    Area("Lincoln Center", Coordinates(40.7725, -73.9835)),
    Area("Upper West Side", Coordinates(40.7870, -73.9754), aliases=("uws",)),
    Area("Upper East Side", Coordinates(40.7736, -73.9566), aliases=("ues",)),
    Area("Central Park", Coordinates(40.7829, -73.9654)),
    Area("Harlem", Coordinates(40.8116, -73.9465)),
    Area("East Harlem", Coordinates(40.7957, -73.9389)),
    Area("Washington Heights", Coordinates(40.8417, -73.9394)),
    Area("Inwood", Coordinates(40.8677, -73.9212)),
    Area("Roosevelt Island", Coordinates(40.7614, -73.9505)),
    Area("Governors Island", Coordinates(40.6895, -74.0166)),
    Area("Randalls Island", Coordinates(40.7936, -73.9218), aliases=("randall's island",)),
    # Brooklyn
    Area("Downtown Brooklyn", Coordinates(40.6928, -73.9860)),
    Area("Brooklyn Heights", Coordinates(40.6959, -73.9937)),
    Area("Dumbo", Coordinates(40.7033, -73.9881)),
    Area("Red Hook", Coordinates(40.6772, -74.0089)),
    Area("Williamsburg", Coordinates(40.7081, -73.9571)),
    Area("Greenpoint", Coordinates(40.7304, -73.9540)),
    Area("Bushwick", Coordinates(40.6944, -73.9213)),
    Area("Bedford-Stuyvesant", Coordinates(40.6872, -73.9418), aliases=("bed stuy",)),
    Area("Crown Heights", Coordinates(40.6694, -73.9422)),
    Area("Park Slope", Coordinates(40.6710, -73.9814)),
    Area("Prospect Park", Coordinates(40.6602, -73.9690)),
    Area("Brooklyn Botanic Garden", Coordinates(40.6680, -73.9632)),
    Area("Flatbush", Coordinates(40.6409, -73.9624)),
    Area("Sunset Park", Coordinates(40.6455, -74.0119)),
    Area("Bay Ridge", Coordinates(40.6264, -74.0299)),
    Area("Coney Island", Coordinates(40.5755, -73.9707)),
    # Queens
    Area("Long Island City", Coordinates(40.7447, -73.9485), aliases=("lic",)),
    Area("Astoria", Coordinates(40.7644, -73.9235)),
    Area("Ridgewood", Coordinates(40.7043, -73.9018)),
    Area("Jackson Heights", Coordinates(40.7557, -73.8831)),
    Area("Corona", Coordinates(40.7449, -73.8626)),
    Area("Flushing Meadows", Coordinates(40.7458, -73.8450)),
    Area("Flushing", Coordinates(40.7674, -73.8330)),
    Area("Forest Hills", Coordinates(40.7195, -73.8448)),
    Area("Jamaica", Coordinates(40.7020, -73.7889)),
    Area("Rockaway", Coordinates(40.5795, -73.8351), aliases=("far rockaway",)),
    # Bronx
    Area("Mott Haven", Coordinates(40.8094, -73.9229), aliases=("south bronx",)),
    Area("Fordham", Coordinates(40.8610, -73.8900)),
    Area("Bronx Park", Coordinates(40.8506, -73.8769), aliases=("bronx zoo",)),
    Area("Riverdale", Coordinates(40.8900, -73.9126)),
    Area("Pelham Bay", Coordinates(40.8506, -73.8214)),
    Area("Van Cortlandt Park", Coordinates(40.8971, -73.8859)),
    # Staten Island
    Area("St. George", Coordinates(40.6437, -74.0765)),
    Area("Snug Harbor", Coordinates(40.6437, -74.1021)),
)


def _normalize(text: str) -> list[str]:
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).split()


def _phrases(area: Area) -> tuple[list[str], ...]:
    return tuple(_normalize(phrase) for phrase in (area.name, *area.aliases))


def find_area(text: str | None) -> Area | None:
    """Ballpark a location from free text, preferring a neighborhood to a borough."""
    if not text:
        return None
    words = _normalize(text)
    matches: list[tuple[Area, int]] = []
    for area in NYC_AREAS:
        best = 0
        for phrase in _phrases(area):
            span = len(phrase)
            if span and any(
                words[index : index + span] == phrase for index in range(len(words) - span + 1)
            ):
                best = max(best, span)
        if best:
            matches.append((area, best))
    if not matches:
        return None
    # A named neighborhood beats the borough that contains it, and a longer phrase
    # ("Flushing Meadows") beats the shorter one it contains ("Flushing").
    matches.sort(key=lambda item: (not item[0].is_borough, item[1]), reverse=True)
    return matches[0][0]

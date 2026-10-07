"""Recognizing branches of major chains, which rank below independent places."""
import re
import unicodedata

from .domain import Candidate

# Curated major chains only: having a brand tag does not establish a national
# footprint. Unknown brands and NYC/NJ regional businesses keep their normal
# scores. For example Dallas BBQ remains local (dallasbbq.com/reservations),
# whereas Dave's spans many states (store.daveshotchicken.com/location/).
# Normalize punctuation/accents and match whole words for unbranded locations.
CHAIN_NAMES = frozenset(
    {
        # Coffee and bakery
        "starbucks",
        "dunkin",
        "pret a manger",
        "le pain quotidien",
        "gregorys coffee",
        "blue bottle coffee",
        "bluestone lane",
        "joe and the juice",
        "peets coffee",
        "tim hortons",
        "au bon pain",
        "panera bread",
        "krispy kreme",
        "cinnabon",
        "insomnia cookies",
        "crumbl",
        # Fast and fast-casual
        "mcdonalds",
        "burger king",
        "wendys",
        "chipotle",
        "sweetgreen",
        "chopt",
        "just salad",
        "chick fil a",
        "daves hot chicken",
        "popeyes",
        "taco bell",
        "five guys",
        "shake shack",
        "wingstop",
        "panda express",
        "sbarro",
        "potbelly",
        "jersey mikes",
        "white castle",
        "halal guys",
        "dominos",
        "papa johns",
        "pizza hut",
        # Sit-down chains
        "applebees",
        "tgi fridays",
        "olive garden",
        "red lobster",
        "cheesecake factory",
        "buffalo wild wings",
        "hooters",
        "ihop",
        "dennys",
        "outback steakhouse",
        "hard rock cafe",
        "planet hollywood",
        "bubba gump",
        # Dessert
        "baskin robbins",
        "cold stone creamery",
        "haagen dazs",
        "16 handles",
        # Retail
        "barnes and noble",
        "books a million",
    }
)
# Short ambiguous names require an explicit brand match, not a name substring:
# a Subway sandwich franchise counts; the unrelated local Subway Inn does not.
CHAIN_BRANDS = CHAIN_NAMES | {"subway"}


def _normalize_place_name(name: str) -> str:
    normalized = name.lower().replace("&", " and ").replace("'", "").replace("’", "")
    decomposed = unicodedata.normalize("NFKD", normalized)
    unaccented = "".join(
        character for character in decomposed if not unicodedata.combining(character)
    )
    return " ".join(re.sub(r"[^a-z0-9]+", " ", unaccented).split())


def is_chain_location(candidate: Candidate) -> bool:
    """Known major chain; local and unclassified brands are not penalized."""
    if candidate.brand:
        return any(_normalize_place_name(brand) in CHAIN_BRANDS for brand in candidate.brand.split(";"))
    words = _normalize_place_name(candidate.name).split()
    for chain in CHAIN_NAMES:
        chain_words = chain.split()
        span = len(chain_words)
        if any(
            words[index : index + span] == chain_words
            for index in range(len(words) - span + 1)
        ):
            return True
    return False

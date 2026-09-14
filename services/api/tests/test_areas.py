from app.areas import find_area


def test_named_neighborhood_beats_the_borough_that_contains_it():
    assert find_area("30-01 Astoria Blvd, Queens").name == "Astoria"
    assert find_area("Prospect Park, Brooklyn").name == "Prospect Park"


def test_longer_area_phrase_wins_over_the_shorter_one_inside_it():
    assert find_area("Flushing Meadows Corona Park, Queens").name == "Flushing Meadows"
    assert find_area("Main St, Flushing").name == "Flushing"


def test_borough_is_used_when_nothing_more_specific_is_named():
    assert find_area("Multiple locations across Staten Island").name == "Staten Island"
    assert find_area("Somewhere in the Bronx").name == "The Bronx"


def test_aliases_and_punctuation_are_matched():
    assert find_area("A rooftop in Bed Stuy").name == "Bedford-Stuyvesant"
    assert find_area("Hell's Kitchen, New York, NY").name == "Hell's Kitchen"


def test_unknown_or_empty_text_has_no_area():
    assert find_area("") is None
    assert find_area(None) is None
    assert find_area("Somewhere in Boston") is None


def test_area_names_are_not_matched_inside_longer_words():
    assert find_area("Coronation Hall") is None

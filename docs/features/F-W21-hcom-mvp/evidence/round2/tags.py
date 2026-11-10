def normalize_tags(values):
    """Return a new list of normalized tags.

    Each value is stripped of surrounding whitespace; values that are empty
    after stripping are dropped. Duplicates are removed, keeping the first
    occurrence. Matching is case-sensitive ("A" and "a" are different tags).
    The input list is not modified.
    """
    seen = set()
    result = []
    for value in values:
        tag = value.strip()
        if tag and tag not in seen:
            seen.add(tag)
            result.append(tag)
    return result

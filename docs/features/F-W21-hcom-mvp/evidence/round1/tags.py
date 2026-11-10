def normalize_tags(values):
    """Strip whitespace, drop empty values, dedupe keeping first occurrence."""
    seen = set()
    result = []
    for value in values:
        tag = value.strip()
        if tag and tag not in seen:
            seen.add(tag)
            result.append(tag)
    return result

def unique_words(text):
    """Return the unique whitespace-separated words of ``text``.

    The first occurrence of each word is kept, in input order. Comparison is
    case-sensitive ("Red" and "red" are different words). Empty or
    whitespace-only input returns an empty list.
    """
    seen = set()
    result = []
    for word in text.split():
        if word not in seen:
            seen.add(word)
            result.append(word)
    return result

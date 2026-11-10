def unique_words(text):
    """Return the unique whitespace-separated words of ``text``.

    Words are split with Python's ``str.split()`` (no argument), so any
    Unicode whitespace separates words, including non-breaking space
    (U+00A0) and em space (U+2003), not just ASCII space, tab and newline.

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

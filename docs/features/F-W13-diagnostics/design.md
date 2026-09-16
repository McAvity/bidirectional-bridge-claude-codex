# Wykonanie wave13

Źródło wymagań: [plan](../../plans/wave13.md). Autoryzacja: [01](decisions/01.md).

Kolejność: W13-01 logowanie i retencja → W13-02 eksport → W13-03 walidacja całości i dokumentacja.
Claude implementuje sekwencyjnie w jednej sesji bridge; Codex koordynuje i niezależnie ocenia kod.
Szczegóły formatu i bezpiecznych punktów zapisu ustala W13-01 w granicach planu.
SQLite pozostaje źródłem stanu; logger zapisuje wyłącznie po autoryzowanym bindingu.
Eksport używa backup API i allowlist, istniejących resolverów tożsamości i doctor.
Build/test dotyczy tego worktree, nigdy przypiętego runtime nadzorującego rundy.
Wymagane testy i scenariusze znajdują się w planie. CI i integracja na feature-workflow
pozostają niewykonane przy zakazie push/merge; dostawa lokalna nie jest odbiorem featura.

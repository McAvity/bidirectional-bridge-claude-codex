# textkit — instrukcje repozytorium

- Python 3.9+, wyłącznie biblioteka standardowa.
- Testy: `PYTHONPATH=src python3 -m unittest discover -s tests -v`.
- CLI: `PYTHONPATH=src python3 -m textkit <polecenie>`.
- Praca nad featurami: `docs/features/README.md` i skille w `.agents/skills/`.
- Taski featurów to pliki Markdown w `work-items/` (Yumi CLI nie jest dostępne w tym repo;
  pole `status` przyjmuje `todo`, `in-progress`, `done`).
- `src/textkit/units.py` jest współdzielony przez moduły `rates` i przyszłe moduły czasu.
- Lokalne repozytorium pilotażowe: bez push i bez zdalnych gałęzi.

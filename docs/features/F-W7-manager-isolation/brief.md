# Wave7: tożsamość managera i izolacja worktree

Zakres zlecony przez użytkownika: etapy 2–3 docs/plans/wave7.md, implementacja z Claude’em przez bridge, niezależne review i zwykłe poprawki bez dodatkowej zgody. Bieżący worktree/branch wave7 jest jedynym miejscem implementacji i buildów. Nadzorujący runtime pozostaje niezmieniany. Diagnostyka, instalator, utrzymanie zależności i pełny odbiór wydania są poza zakresem.

## Kryteria odbioru

- AC-01: trwałe powiązanie projekt → worktree → feature → manager → task/runda → próba → natywna sesja wykonawcy; branch nie stanowi tożsamości worktree. Rola codex pozostaje odrębna od tożsamości sesji managera.
- AC-02: drugi manager tego samego worktree/featura jest blokowany przed mutacją lub uruchomieniem wykonawcy; jeden aktywny feature na worktree. Równoczesne próby nie omijają blokady.
- AC-03: restart/wznowienie identyfikuje dokładnie przypisanego managera; przejęcie jest jawne i sprawdza poprzednie powiązanie. Nie wybiera najnowszej sesji z cwd, guardiana ani auto-review; niejednoznaczność kończy się czytelnym błędem. Brak automatycznego uruchamiania zamkniętego managera.
- AC-04: dwie rzeczywiste ścieżki Git worktree tego samego projektu mają osobne bazy, pliki, artefakty/paczki i logi; skopiowana/współdzielona .bridge lub jawny wspólny --db zostaje odrzucony. Uwzględnić symlinki i canonical paths.
- AC-05: restart w waiting_user i dalsza runda zachowują pytanie, odpowiedź, historię i dokładną sesję Claude’a; druga para działa niezależnie. Brak cichego zastąpienia, duplikatów i obejścia kontroli przez recovery lub narzędzia ogólne.
- AC-06: zaktualizowana dokumentacja i instrukcje ról wyjaśniają identyfikację, wznowienie, stan legacy i konfigurację nowego worktree. Nie powstaje instalator ani doctor/diagnose.
- AC-07: build i wymagane testy repo przechodzą; nowe testy obejmują rzeczywisty SQLite, dwa Git worktree, konflikt managerów, restart/przejęcie i regresje. Testy z atrapą adaptera są tak opisane; nie stanowią dowodu dwóch żywych par modeli.

Odbiór techniczny i akceptacja użytkownika to osobne fakty. Pełny real-model pilot dwóch par z etapu 6 pozostaje osobną bramką wydania; nie oznaczać go PASS na podstawie syntetycznych testów.

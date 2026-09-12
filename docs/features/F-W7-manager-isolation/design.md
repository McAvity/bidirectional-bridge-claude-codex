# Plan techniczny i bramki lokalne

Baza: `aeb92c2f35670b73aa9e204f68f3734d2ad2cc37`, czysty branch `wave7`.
SHA-256 briefu: `64c12e87764e3712c0e7a658b93e5c3558bb254986ca158cb20a8f5d91539e6e`.

Zweryfikowany stan: scripts/native-bridge-mcp.mjs wiąże tylko caller/delegation oraz workspace/db; BridgeMcpServer przekazuje rolę w ToolContext; FeatureWorkflow.owned porównuje tylko manager=codex; FeatureRecord nie ma workspace/session identity. ControlPlane.open otwiera wskazany SQLite bez trwałego sprawdzenia worktree. Orchestrator przekazuje cp.workspaceRoot do adapterów i zachowuje uchwyty prób. Istnieją testy feature-workflow, recovery, tools i native-launcher.

Najmniejszy kierunek: osobny trwały identyfikator przestrzeni pracy i powiązanie bazy z kanonicznym projektem/worktree; odrębny natywny identyfikator sesji managera z kontekstu MCP, preferencyjnie wiązany atomowo przy pierwszym wywołaniu wymagającym własności (decyzja 06), i kontrola wyłączności. Rola nadal wybiera adapter i reguły lineage. Wszystkie wejścia mutujące i recovery muszą respektować manager binding. Jawny restart/przejęcie ma zachować historię i dokładną sesję, nie zgadywać jej z cwd. Kontrakt rozstrzygnie konkretny format, atomowość, blokady procesów, obsługę legacy i symlinków przed zmianą kodu.

Kolejność: W7-ID-01 tworzy kontrakt i przykłady; koordynator wykonuje niezależne review kontraktu względem briefu i kodu. W7-ID-02 implementuje zaakceptowany lokalnie kontrakt, testy i dokumentację. Następnie koordynator bada diff/paczkę, powtarza rozstrzygające testy, zleca poprawki w tej samej sesji Claude’a i zapisuje końcowe review. Istotne wybory zmieniające zgodne zachowanie lub blokady trafiają do użytkownika; zwykłe decyzje implementacyjne mieszczą się w zleceniu.

Własność: Claude edytuje wyłącznie zakres rundy, koordynator indeks, taski, decyzje, review i checkpointy. Nie ma równoległych zapisów; jeden worktree na tę zmianę. Brak Yumi w repo: kanoniczne taski Markdown są w work-items/, zgodnie z kontraktem eksportera i jego testami. Decyzja 03 koryguje wcześniejszy fallback docs/tasks/; stare ścieżki pozostają wyłącznie odsyłaczami. Nie zainstalowano nowego systemu tasków. Istniejący review-integration-drift.md pozostaje nieaktywną propozycją.

Walidacja z bieżącego worktree: npm ci --ignore-scripts; npm run build; npm test; python3 -m unittest discover -s tests -v; python3 -m unittest discover -s tools/pilot/tests -v. Środowisko odczytane: Node 24.15.0, Python 3.12.3 (instrukcje repo podają przetestowany 3.11). Testowe worktree/bazy/logi mają używać osobnych katalogów tymczasowych; żaden build ani edycja nie dotyka nadzorującego runtime. Bez uruchamiania operatorowych pilotów ani ujawniania ich fixture’ów workerowi.

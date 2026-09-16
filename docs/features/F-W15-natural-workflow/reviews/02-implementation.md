# Review implementacji — REWORK, 2026-09-16

Koordynator Codex, niezależny od wykonawcy Claude (uczestniczył w koordynacji).
Task task_axt2g9bfzf; e66c6d7..ea7d1bd75e2c418c96694bb5c07cbac31cb571d5.
Paczka r02 PASS, zakres czysty. Poniższe wymagane korekty mieszczą się w decisions/01.
W15-03 może być implementowane razem z nimi zgodnie z rozstrzygniętym kierunkiem;
W15-02 nie jest jeszcze zamknięte. Bez nowej decyzji użytkownika i bez zmiany MCP API.

## W15-I1 — preferencja legacy wskazuje nieistniejące wejście (blocker AC-03/08)

scripts/bridge.mjs wywołuje planChange domyślnie profile=legacy. PREFERENCE_BLOCK zawsze
wskazuje .bridge-project/entry.mjs, ale legacy go nie instaluje. Niezależna próba
planChange(init, preference=true) w pustym tymczasowym repo: ok=true,
entryCreated=false, preferenceMentionsEntry=true. Minimalna poprawka: jawna nazwana
odmowa opcji dla legacy z kierowaniem do istniejącego setupu dispatcher; nie rozszerzać
instalatora ani nie przepinać projektu automatycznie. Alternatywnie poprawne wejście
legacy, tylko jeśli prostsze i rzeczywiście zweryfikowane. Test uruchamia wskazane wejście
albo potwierdza odmowę przed zapisami, nie tylko sprawdza tekst.

## W15-I2 — nowy AGENTS.md bez konkretnego diffu (blocker wymogu planu)

planPreference create nie ustawia previous, oba CLIs dodają diff tylko gdy previous
istnieje. Niezależna próba: hasPrevious=false. Plan dla projektu bez AGENTS.md pokazuje
jedynie nazwę pliku, a nie treść proponowanej preferencji. Pokazać diff od pustej treści
na obu publicznych powierzchniach; regresja dla brakującego i pustego pliku.

## W15-I3 — plugin status nie sprawdza commita pinu (blocker AC-03/08)

locate.status weryfikuje runtime, ale nie porównuje manifest.source.commit z deklaracją.
Niezależna próba na realnym zainstalowanym runtime i syntetycznej deklaracji z commit=40 zer:
state=inherited-pristine, runtime=ok, instructionsAvailable=true. Nowy entry ten mismatch
odmawia; plugin ładuje wtedy niewłaściwy zestaw. Wspólna klasyfikacja: mismatch ->
brak instructions, konkretny kod/next step, bez zapisu. Test obu wejść na tym samym stanie.

## W15-I4 — marker nie dowodzi preferencji (blocker AC-02)

hasPreference zwraca declared=true dla dowolnego poprawnego bloku. Próba z treścią
„Never delegate implementation.” wewnątrz markerów również dała declared=true.
Nie przedstawiać obecności markerów jako zgody. Status może rozpoznać dokładny znany
blok; zmieniony/nieznany tekst wymaga przeczytania AGENTS i interpretacji instrukcji,
a „zrób sam”/zakaz zawsze wygrywa. Zwykła ręczna preferencja poza markerami także może
być ważna: flagi techniczne nie są źródłem autoryzacji. Dodać regresję zaprzeczenia.

## W15-I5 — cienkie wejście pluginu (blocker wskazanej granicy planu)

Szablon kopiuje klasyfikację brief/plan/review z role skill, zamiast tylko wykrywać
zlecenie i ładować instrukcje wybranego runtime. To tworzy wersję workflowu niezależną
od pinu. Zostawić trigger i minimalne granice zgody/setupu; klasyfikację i prowadzenie
pracy utrzymać kanonicznie w przypiętym role/workflow. Dokumentacja ma wskazać, że
nowy --status wymaga runtime z wave15; nie uruchamiać flagi na starszym dispatcherze
jako pewnego odczytu (starszy kod traktuje ją jak zwykły start MCP).

Dowody: odczyt pełnego diffu kodu/instrukcji/testów; izolowane próby Node planChange
oraz locate.status na rzeczywistym runtime, bez modelu i bez zmian jego plików.
Paczka, diff check PASS. Testy wykonawcy: 6 entry/plugin + 3 preference PASS;
nie pokrywają powyższych przypadków. Pełna walidacja po korektach.

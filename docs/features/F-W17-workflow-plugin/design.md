# Wave17 — projekt dystrybucji workflowu

Status: propozycja do review planu. Kod badany: `1d7f93bd766cdeb7fc8be517f4caf30c70738962`.
Wejście: [brief](brief.md), SHA-256 `31a0b69bb8882d6a5b8d3bdc875d6edac2e2ae1826e620f4bf91e1ec44367219`.
Nie przeprowadzono nowych prób klientów ani modeli w trakcie planowania.

## Stan zweryfikowany w repo

- `scripts/plugin-packages/generate.mjs` generuje bridge-codex (cienki skill wejścia
  i instalator) oraz bridge-claude (sześć feature-*, using-bridge i przewodnik).
  Obecne manifesty to `.agents/plugins/marketplace.json` i
  `.claude-plugin/marketplace.json`, nazwa marketplace: claude-codex-bridge.
- Kanoniczne źródła to `.agents/skills/`, role using-bridge i `docs/features/README.md`.
  Generator przepisuje odsyłacze instrukcji, kopiuje kod bez modyfikacji oraz sprawdza
  zgodność wygenerowanych drzew i ich źródeł.
- `scripts/bridge-project/locate.mjs:instructionPaths` zwraca workflow_skills,
  exchange_helper, codex_role_skill i claude_executor_package z wybranego runtime.
  Wejście projektu `--status` jest odczytem; istnieją ograniczenia starszych runtime.
- `scripts/native-bridge-mcp.mjs` przekazuje pluginDir runnerowi, który dodaje
  `--plugin-dir` dla Claude'a. Obecna ścieżka paczki wykonawcy to plugins/bridge-claude.
- `tests/test_plugin_distribution.py`, `scripts/plugin-probes/` i testy
  `scripts/bridge-project/bridge-project.test.ts` dają istniejącą bazę testów hostów,
  generatora i wyboru instrukcji. Wyniki wave14 są kontekstem, nie dowodem nowego układu.
- Yumi CLI nie znaleziono na PATH; repo używa Markdown w work-items/. Stosujemy ten
  fallback, bez instalacji nowego systemu. Nie znaleziono istniejących W17 ani wave17.

## Najmniejsza proponowana zmiana

Dodać do tego samego generatora dwa pakiety: roboczo
`plugins/feature-workflow-codex/` i `plugins/feature-workflow-claude/`, oraz po jednej
pozycji do istniejących manifestów. To jeden produkt workflow, nie dwa źródła skilli.
Nazwy finalne i skład paczek utrwali W17-01 po sprawdzeniu wykrywania przez klientów.
Na początek użyć obecnej wersji wydania repo i digestu źródeł; niezależny release train
workflowu nie jest potrzebny w tej fali.

Każdy plugin udostępnia sześć publicznych wejść. Wejścia wybierają zasoby, nie kopiują
całego procesu zarządzania. Pakiet niesie zasoby do pracy samodzielnej; przy bridge
kieruje do instrukcji wybranego runtime. Nie utrzymywać oddzielnego algorytmu wyboru
pinu ani drugiej maszyny stanów. Preferować istniejący odczyt statusu projektu;
konkretne pakowanie readera dla instalacji bez bridge-pluginu rozstrzygnąć w W17-01.
Nie uruchamiać legacy entry jako MCP przypadkiem pod pretekstem odczytu --status.

| Kontekst | Źródło i zachowanie |
| --- | --- |
| Brak projektu bridge i brak delegacji | Własne zasoby pluginu; bez instalowania lub włączania bridge'a. |
| Projekt z poprawnym pinem | Instrukcje runtime, także dla jawnie samodzielnego taska; węższe polecenie użytkownika zachowuje pierwszeństwo. |
| Claude jako wykonawca rundy | Paczka przekazana przez runtime i rola z kontraktu; bez zależności od osobistego marketplace. |
| Pin brakujący/uszkodzony, konflikt lub legacy bez wspieranego odczytu | Jawna diagnoza i instrukcja rozwiązania; bez cichej zmiany wersji, pinu ani instalacji. Oddzielna praca bez bridge'a wymaga jasnego zakresu, nie fallbacku z niedziałającej delegacji. |

Nowszy plugin musi umieć użyć obsługiwanej starszej wersji runtime: np. nie usuwać
w locie obowiązku ZIP starych rund. Deklarowana macierz wsparcia i czytelna odmowa
poza nią są lepsze niż pozorna zgodność. Żadnej zgody nie wywodzimy ze statusu setupu.

## Kontrakt i migracja — lokalna bramka W17-01

Wynik: `contracts/01-distribution.md`, przykłady dla obu klientów i dowody bez modeli.
Sprawdzić publiczne nazwy, względne ścieżki, kolizje i discovery, kombinację pluginu
osobistego ze wskazanym --plugin-dir, źródło runtime oraz update/uninstall.
Nie zakładać pierwszeństwa paczek ani obsługi zależności pluginów bez dowodu hosta.

Obecnego bridge-claude nie usuwać lub zmieniać ścieżki na ślepo: jest częścią kontraktu
runtime. Preferowany wariant zgodności to pozostawienie samowystarczalnej paczki
wykonawcy generowanej z tych samych źródeł oraz migracja publicznego użycia do pluginu
workflow. W17-01 ustali, czy legacy bridge-claude wymaga wyłączenia w osobistym profilu,
czy wystarczą jednoznaczne wejścia. Migracja konfiguracji użytkownika jest jawna;
nie odinstalowywać niczego automatycznie. Duplikaty nazw nie mogą skłaniać agenta
do losowego wyboru. W razie konieczności zmiany ścieżki runnera sprawdzić cały kontrakt
instrukcji i zachować działanie już zainstalowanych runtime.

## Kolejność i własność

Zależności są zapisane w work-items/W17-01.md…W17-04.md, nie w osobnym backlogu.
W17-01 może przygotować kontrakt po zleceniu wykonania. W17-02 wymaga dodatkowo
zintegrowanego wave16 i odnotowania jego finalnego SHA. Nie poprawiamy tutaj skilli
wave16 równolegle i nie wymuszamy ich finalnej wersji już podczas planowania.
Jeśli finalny wave16 zmieni założenia kontraktu, zaktualizować tylko dotknięte ustalenia.

Jeden koordynator jest właścicielem integracji i indeksu. Wykonawca W17-02/03
odpowiada za generator, szablony, manifesty i ewentualne połączenie z readerem/runtime;
nie edytować ich równolegle w dwóch taskach. Po kontrakcie można niezależnie przygotować
fixture'y hostów i szkic dokumentacji, ale finalne AC wymagają wspólnego wyniku.
Kod/instrukcje kontraktu ocenia reviewer niezależny od wykonawcy, bez stałej marki modelu.
Lokalne review kontraktu nie jest kolejną akceptacją użytkownika.

## Walidacja, dowody i granice

Macierz: Codex i Claude, workflow-only, oba pluginy, legacy bridge-claude oraz runtime
wykonawcy; projekt bez bridge'a, poprawny pin, brakujący pin i konflikt. Użyć dwóch
różnych wersji instrukcji, żeby test wyboru nie przechodził przypadkiem na identycznych
plikach. Aktualizacja pluginu ma zachować pin i treść starego runtime.

Testy hostów w jednorazowych profilach: odkrycie sześciu wejść, odsyłacze i helpery,
wybór źródła, kwalifikowane wywołania, update/uninstall i brak zapisów przy odczycie.
Proces delegowanego Claude'a sprawdzić istniejącą ścieżką launchera z kontrolowaną
atrapą oraz, gdzie możliwe, prawdziwym klientem bez tury modelu. Nie liczyć tych prób
jako dowodu jakości decyzji modelu. Niedostępny klient/test jest SKIP lub UNVERIFIED.

Przy implementacji: kontrole z AGENTS (npm ci --ignore-scripts, build, npm test,
Python tests i tools/pilot/tests), packages:check, linki dokumentacji i diff.
Raport mapuje AC do dowodów i osobno opisuje ograniczenia behawioralne. Opcjonalny
smoke modeli wymaga osobnego scenariusza, budżetu i zgody; nie zlecono go tym planem.
Nie powtarzać starych pilotów bez konkretnej regresji. W16 i W15 mają własne dowody.

## Odbiór i następny krok

Teraz: feature-review w trybie plan, potem feature-decide. Proponowane późniejsze
zlecenie obejmuje cały W17-01–04, integrację na branchu wykonania, niezależne lokalne
review i poprawki w zakresie briefu. Publikacja marketplace/release, zmiana pinów
projektów i osobistych profili pozostają osobnymi czynnościami; plan ich nie uruchamia.

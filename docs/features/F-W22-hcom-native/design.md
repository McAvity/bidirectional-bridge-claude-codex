# F-W22 — plan workflowu bez własnego MCP

Status: proposed; review01 PASS, doprecyzowania R01-01/02 przyjęte w planie;
przygotowanie przez feature-flow, bez zgody Gate 1 na wykonanie.
Baza źródeł: `1c74346` (brief); kod odziedziczony z `2aca4f5`.
Brief SHA-256: `7e3b746399386e4404f652db432bc60fc42a45c68d8cf03454fb463c0a351a7d`.
INSTRUCTIONS=bundle:1.1.3-ca0ed85dea2a IDENTITY=sha256:ca0ed85dea2a1d8ce2814609a1a1e36416d52b3a00012aeefdee566a0aaeebb6 GENERATION=1

Użytkownik wywołał feature-flow dla F-W22. Planowanie, lokalne commity i niezależne
review są zlecone; implementacja, próby modelowe i publikacja nie są jeszcze zlecone.
Repo ma Markdown `work-items/`, bez dostępnego Yumi CLI. Nie ma aktywnego ogólnego
itemu obejmującego F-W22; W22-P01 obejmuje przygotowanie. Nie zmieniamy dawnych tasków.

## 1. Zweryfikowany stan i granice

| Element | Obecna zależność | Planowana zmiana |
| --- | --- | --- |
| `scripts/workflow-source/select-source.mjs` | Pierwszeństwo pina; disabled/pozostałości `.bridge` mogą odmówić pracy standalone | Jawna klasyfikacja nowego trybu przed dawnym resolverem; archiwalne pozostałości po migracji nie wymagają runtime'u |
| `scripts/workflow-source/workflow.mjs` | `projectState` klasyfikuje runtime przed odczytem locka; nawet istniejący bundle może wymagać runtime'u | Nowy tryb rozwiązuje istniejące locki i nowe wydanie bez importu kodu runtime'u |
| `workflow-lib.mjs` | Zweryfikowany store, publikacja bundle, restore, standalone switch już istnieją | Wykorzystać, nie budować drugiego store; zachować immutable identity i historię locka |
| `.agents/skills/feature-execute` i `feature-flow` | Hcom jest jawnie wybierany; brak wyboru zachowuje local/Bridge | Dla nowych feature'ów w nowym trybie domyślny hcom; zapisany transport istniejącej pracy pozostaje rozstrzygający |
| `scripts/plugin-packages/generate.mjs` | Oddzielne wersje bridge i workflow, siedem wejść feature, generator kopiuje źródła | Nowy lifecycle dostarczany z workflow; legacy bridge pozostaje wyłącznie opt-in, bez zależności nowego pakietu |
| `scripts/plugin-packages/skills/bridge-upgrade` | Odświeża stare pluginy, instaluje runtime i odsyła do upgrade-local | Kompatybilne wejście kieruje do nowego lifecycle; instalacja wydania i migracja projektu są osobnymi operacjami |
| `scripts/upgrade-local.mjs`, `setup/workspace.mjs` | Plan/apply pinów, obserwacja klientów, doctor MCP | Zachować dla jawnego legacy; nowa instalacja workflow nie wywołuje tych operacji |
| `.codex/config.toml`, `.mcp.json` | Automatyczny start bridge przez projektowy dispatcher lub `.bridge-runtime/current` | Migracja usuwa tylko rozpoznane własne wpisy; nowe instalacje ich nie tworzą |
| `setup/workflow-status.mjs` | Rozróżnia configured/verified/admitted/observed, używa runtime'u | Zachować znaczenie warstw; nowy status nie wymaga runtime advertisement ani bazy Bridge |

`classifyNativeState` rozpoznaje pochodzenie `.bridge`, a `readStateSchema` tylko
wersję DB. Żaden z nich sam nie dowodzi zakończenia tasków. Potrzebny jest mały,
odczytowy adapter migracyjny rozumiejący stany tasków, prób, feature'ów i lease'ów.
Nie kopiujemy do nowego workflow silnika koordynacji.

## 2. Docelowy podział i minimalny interfejs

Jedna dystrybucja workflow zawiera instrukcje, istniejące helpery hcom oraz małe CLI
lifecycle. Proponowany kanoniczny plik: `scripts/workflow-source/lifecycle.mjs`,
kopiowany przez generator do wydania obu klientów. Operacje: `status`, `install`,
`migrate`, `doctor`. Dokładny format i flagi zamraża W22-01 przed konsumentami.
Plan/read domyślnie; zapis wymaga jawnego apply w wywołaniu przez uprawnionego agenta.

- `install`: źródło to dokładna tożsamość wydania/pluginu; weryfikacja i publikacja
  istniejącym storePublish. Bez budowania starego runtime'u, bez DB i obserwacji procesów.
  Wydanie już obecne i poprawne daje no-op; konflikt treści nie nadpisuje katalogu.
  Pobranie/odświeżenie pluginu przez CLI klienta to etap dystrybucji; deferred command
  wskazuje zachowane wydanie, nigdy cache mogący zniknąć po refreshu ani plik Temp.
- `migrate`: osobny, jednorazowy plan zmian projektu; zwykłe `install` nigdy nie
  wykonuje migracji automatycznie. Jawne zlecenie upgrade starego projektu może objąć
  oba kroki, ale raport odróżnia zainstalowane wydanie od niedokończonej migracji.
- `status/doctor`: tryb projektu, zainstalowane wydania, wybrane locki, integralność,
  dostępność hcom/klientów i konflikt konfiguracji MCP; bez uruchamiania modelu.
  Brak dowodu załadowania instrukcji daje `unknown`, nie `loaded`.

Proponowany minimalny znacznik migracji: `.feature-workflow/project.json` z wersją
formatu i `mode: hcom`; bez nowego pina runtime'u, kopiowania locków ani sesji.
Świeże repo bez śladów legacy działa domyślnie w hcom również bez tego pliku.
Znacznik jest potrzebny dla projektu z zachowanymi archiwalnymi śladami Bridge.
Nie jest uprawnieniem do wykonywania pracy. W22-01 ustali dokładne pola, walidację,
stany nieukończonej migracji oraz rozdzielenie przenośnego wyboru trybu od lokalnego
potwierdzenia odłączenia procesu. Nowy worktree nie dziedziczy dowodu zamknięcia sesji.

Brak znacznika przy istniejącym legacy oznacza `migration-required`, a nie ciche
ominięcie pina. Uszkodzony/nieznany znacznik oznacza konkretną odmowę. Jawny legacy
zachowuje dotychczasowy resolver i zabezpieczenia; domyślna instalacja go nie wybiera.

## 3. Migracja bez utraty pracy

Zakres pierwszej migracji: rozpoznane projekty Bridge 0.8.x; starsze/nieznane
schematy dostają precyzyjną diagnozę i zachowany stan, nie zgadywaną konwersję.
W22-01 zinwentaryzuje faktyczne schematy obecne w obsługiwanych runtime'ach.
Nie wymagamy upgrade'u starego silnika tylko po to, by odczytać jego wersję.

1. Odczytać konfigurację, pochodzenie lokalnego stanu i DB tylko read-only. Wskazać
   konkretne nieterminalne taski, otwarte próby/feature'y, lease'y lub niedokończone
   operacje. Sam manager bound, brak PID lub brak aktywnego modelu nie rozstrzygają
   tej oceny. Rozróżnić zakończoną historię od nierozliczonej pracy.
2. Przy nierozliczonej pracy odmówić migracji z identyfikatorem i dalszym działaniem;
   bez przyznania sukcesu, kasowania DB, takeover, automatycznego replay i przenoszenia
   tasków. Instalacja nowego wydania pozostaje możliwa.
3. Planować odłączenie tylko wpisów należących do tego produktu: zarządzany blok
   Codexa i rozpoznany wpis JSON Claude, z rozpoznaniem historycznych wariantów.
   Zachować pozostałe serwery, komentarze/ustawienia i lokalne modyfikacje. Nierozpoznany
   wpis o nazwie bridge jest konfliktem, nie zgodą na jego skasowanie. Globalny wpis
   MCP jest diagnozą wymagającą oddzielnego zakresu, nie powodem zmiany innych projektów.
4. Zachować dawną deklarację z wyłączonym startem oraz archiwalny runtime/DB i locki.
   Po migracji nowy resolver nie wymaga obecności runtime'u nawet gdy archiwum go wskazuje.
   Żaden nowy manifest ani domyślny skill nie włącza starego serwera ponownie.
5. Zmiany wieloplikowe mają plan wejściowych hashy, prywatne backupy i mały dziennik
   do bezpiecznego dokończenia. Znacznik zakończenia zapisywany na końcu. Retry nie
   usuwa danych, nie przyjmuje zmienionych wejść i nie odblokowuje stanu częściowego.
6. Odłączenie konfiguracji nie dowodzi zatrzymania MCP już działającego w kliencie.
   Jednorazowo wymagamy zamknięcia/przeładowania tego połączenia, z kontrolą tylko
   procesu/otwartego stanu konkretnego starego MCP, bez skanowania writerów Codexa.
   W22-01 musi rozwiązać wyścig między końcowym odczytem stanu a zmianą konfiguracji:
   migracja nie ogłasza zakończenia, gdy stary proces może nadal rozpocząć rundę.
   Nieznana obserwacja daje `migration-pending`, bez zabijania wspólnego serwera.

Adapter, detekcja procesu i backup DB należą wyłącznie do migracji. Po zakończeniu
żadna zwykła aktualizacja nie uruchamia tych kontroli. Retencja starych bundle bez
automatycznego garbage collection usuwa potrzebę badania, kto używa starej kopii.

Istniejący feature z lockiem zachowuje dokładną identity. Stary lock bez wsparcia
hcom nie zostaje automatycznie podniesiony; zakończenie starej pracy albo jawny switch
między rundami pozostają odrębną decyzją. Przy legacy bez locka odtwarzamy tylko
udowodnioną wersję lub prosimy o konkretny wybór. Nie przypisujemy bieżącego pluginu.

R01-01: obecność hcom nie jest wystarczającą zgodnością. W szczególności bundle1.1.3
zawiera dawny resolver, który może odmówić po wyłączeniu pina. Kontrakt/testy obejmą
cały łańcuch entry → resolver → wybrane helpery. Historia locka i bajty pozostają,
ale nie oznacza to automatycznej możliwości wznowienia starej wersji po migracji.
Jeżeli kontynuowana praca jest z nią niezgodna, migracja pozostaje pending z konkretną
diagnozą i propozycją zakończenia pracy albo jawnego switch między rundami. Nie
modyfikujemy starego bundle ani nie wymuszamy jego działania przez cichy override.
Sama instalacja nowego wydania nadal jest możliwa. Test AC-05 aktualizacji n → n+1
dotyczy zgodnych wydań nowego trybu; przypadek 1.1.3 jest osobnym testem migracji.

## 4. Skille, wersje i aktywacja klienta

Domyślny transport hcom dotyczy nowych zleceń delegowanych w trybie bez MCP;
nie zamienia każdego drobnego zadania lokalnego w delegację. Zachowujemy jawne
ograniczenia użytkownika, dawne wybory transportu i bramki feature-flow.
Hcom loop nadal sprawdza sesję/katalog/rundę, readiness, receipt, uncertain send
i guarded finish; nie tworzymy osobnego równoległego protokołu.

`feature-flow`, pozostałe fazy i source preamble nie wymagają bind/resume/accept
przez Bridge w nowym trybie. W22-04 usuwa takie zależności także z AGENTS.md tego
repo i roli using-bridge w domyślnej ścieżce, zachowując historyczne instrukcje legacy.
Użytkownik nie potrzebuje projektu z dopisanym specjalnym AGENTS.md.

Raport lifecycle rozróżnia co najmniej: `installed`, `selected` (per feature),
`client_activation` (potwierdzone/nieznane/wymaga reloadu) i `migration`.
Upgrade nie zmienia locków i nie reklamuje nowej wersji modelowi jako już załadowanej.
Jeżeli klient potrafi przeładować plugin w sesji, używamy potwierdzonej procedury;
w przeciwnym razie informujemy o restarcie potrzebnym do aktywacji, po udanej instalacji.
Dokładne możliwości klientów pozostają do sprawdzenia na zainstalowanych wersjach
i w ich oficjalnej dokumentacji w W22-04, bez obietnicy hot reloadu.

Nowe kandydackie wydania bridge-entry i workflow są przygotowane lokalnie przez
generator. Dotychczasowe wydania i registry są immutable. Numer wydania wybiera
się zgodnie z wersjonowaniem komponentu przy pakowaniu; nie podmieniamy 1.1.3.
Stary backend pozostaje dostępny jako jawny legacy, nie jest częścią domyślnej
ścieżki. Usunięcie źródeł backendu i publiczne wydanie nie są warunkami F-W22.

## 5. Wykonanie, własność i integracja

Zadania W22-01…06 są sekwencyjne (zależności w taskach), jedno repo, bez nowego
systemu tasków. Koordynator utrzymuje indeks, decyzje i review. Wykonawca dostaje
konkretny zakres źródeł; generator i wszystkie wynikowe paczki mają jednego właściciela
w danym kroku. Kontrakt W22-01 ma niezależne review przed W22-02/03, bez dodatkowej
zgody użytkownika dla zwykłych szczegółów technicznych zgodnych z briefem.

Przygotowanie bieżącego planu rejestrowane jest w obecnym MCP wyłącznie jako task
dokumentacyjny, bez feature/root rund wykonawcy. Zostanie rozliczone przed Gate 1.
Proponowane wykonanie F-W22 używa hcom z zapisanym transportem; nie migruje aktywnego
taska MCP i nie modyfikuje zainstalowanego runtime'u nadzorującego tę sesję.
Zmiany i testy produktu korzystają z izolowanych fixture'ów oraz kandydackich paczek.
Żaden rzeczywisty projekt użytkownika nie jest migrowany w ramach testu.

## 6. Walidacja i próba użytkowa

W22-05 wykonuje Node24 build/npm test, Python tests i pilot tests zgodnie z AGENTS,
packages:check, walidację skilli oraz ukierunkowane testy lifecycle/source/migration.
Istotne regresje: zgodność źródeł i generated packages, obsługa starych locków,
obce symlinki/ścieżki, błędna integralność, przerwanie publikacji/migracji,
zmieniona konfiguracja podczas apply, błędne/splątane DB oraz legacy guards.

Fixture `install` ma wybuchające atrapy wszystkich legacy process/writer/DB probes:
sukces dowodzi braku wywołań. Test dwóch projektów utrzymuje stare wybrane bundle
i dodaje nowe, porównując hashe i locki. Nie udaje to próby z rzeczywistym modelem.

W22-06: dwie małe izolowane próbki repo (świeża i zmigrowana z syntetyczną, zakończoną
historią Bridge), bez operatorowych AGENTS.md i bez dostępu do dawnych rozwiązań.
R01-02: z `tools/pilot/rework/OPERATOR.md` przejmujemy wyłącznie zasady separacji,
dowodów i limitów; nie wykonujemy jego launchera, `/mcp` ani starego preflightu.
W22-06 zapisuje własny protokół startu i obserwacji hcom bez MCP przed próbą.
Zwykły prompt: „Wykonaj feature F-001”. Każde repo ma wcześniej przygotowany brief,
plan i zgodę na małe zadanie, aby nie mieszać Gate 1 zadania pilota z testem transportu.
Świeży koordynator musi sam odnaleźć workflow i uruchomić hcom bez dopisku „przez hcom”.
W pierwszej próbie instalujemy kolejne kandydackie wydanie podczas aktywnej rundy;
receipt i wznowienie w tej samej wersji potwierdzają brak podmiany. Nowy feature po
aktywacji klienta wybiera nowe wydanie, bez wymagania nowej pracy modelowej.
W drugiej sprawdzamy identyczną obsługę po migracji. Rejestrujemy brak startu MCP
w obu rolach, rzeczywiste wersje/skille, reloady, interwencje i wynik odbioru.

Proponowany budżet Gate 1: do dwóch świeżych koordynatorów i dwóch sesji Claude,
do dwóch rund wykonawcy na projekt (łącznie cztery dispatch), 15 minut na rundę
i 60 minut całej próby modelowej. Istniejące konta/modele, tryb auto, bez nowych
kluczy/API, zakupów, bypass ani globalnej zmiany ustawień. Zużycie limitów konta;
koszt pieniężny pozostaje nieznany, jeśli klient go nie raportuje. Native reviewer
planu/kontraktu nie jest workerem pilota. Budget po wyczerpaniu zatrzymuje próbę;
nie wolno przedstawiać samej gotowości harnessu jako AC-01 PASS. Negatywny wynik
daje poprawki w ramach pozostałego budżetu albo konkretny handoff unmet, nie odbiór.

Do końcowego odbioru potrzebny niezależny review implementacji i rzeczywisty dowód
AC-01/04/05/08. Brak możliwości obserwacji któregoś klienta pozostaje ograniczeniem
i nie upoważnia do obietnicy, że wszystkie klienty reloadują bez restartu.
Push, merge, publikacja i migracja użytkowych repo są poza proponowaną zgodą.

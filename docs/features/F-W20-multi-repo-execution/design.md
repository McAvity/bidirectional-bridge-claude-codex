# F-W20 — plan izolacji i dostawy wielu repozytoriów

Status: plan do niezależnego review; brak zgody na wykonanie. 2026-11-05.
Brief: [brief.md](brief.md), SHA-256 `ae8bca3467690b6ab884b40ddfcfabc8bdeac4986a0694cb0ffb3abd33ebdc7d`.
Inspekcja: `17fd10ad1334363079f39f261592b128e3103139`, baza produktu `417ddc2`.
Kod istotny dla tej zmiany jest identyczny z integration branch `5257ca6`;
różnice tego brancha to dokumentacja F-W19/checkpointy i pin runtime.
F-W19 ma już plan i zgodę na wykonanie, lecz nie implementację. Historyczny brief
F-W20 pozostaje bez zmian; jego wzmianka o stanie F-W19 opisuje dzień designu.

## Fakty i najmniejsza zmiana

`feature-execute/SKILL.md` ma odrębną sekcję wykonawcy zastępującą resztę instrukcji.
`references/local-delivery.md` oraz `tests/test_local_delivery.py` opisują jedno repo;
odbiór sprawdza każdy commit, nie tylko końcowy diff. `shared/protocol/src/scope.ts`
normalizuje globs tekstowo, odrzuca `..`, nie rozwiązuje realpath. Lease operuje na
tych globs, nie na fizycznych checkoutach. `changed_scope` w schemas.ts jest tablicą.
Generator pluginów kopiuje kanoniczne drzewo skilli; feature-exchange nie eksportuje
automatycznie ignorowanych child repo ani zawartości submodule/symlinków.

Dodajemy jedną referencję `feature-execute/references/multi-repo.md`, mały odczytowy
helper w `feature-execute/scripts/multi_repo.py` i odsyłacze w istniejących rolach.
Helper redukuje pomyłki realpath/Git/odbioru; nie tworzy worktree, nie wykonuje skryptów
z manifestu, nie mutuje baz bridge'a. Nie powstaje nowy manager, MCP ani lifecycle.
Zwykły single-repo local-v1 i historyczne kontrakty pozostają bez zmian.

## Przygotowanie dopiero w execute

Plan identyfikuje logiczne repo ID, źródła, constraints/piny i gałęzie integracyjne
bez lokalnych ścieżek. Execute w dostarczonym parent worktree odczytuje AGENTS,
submodule/gitlinks, lokalne dependency bindings i komendy build/test/hook/codegen.
Nie skanuje całego dysku. Rejestr obejmuje repo dotknięte pracą i rzeczywiste cele
zapisu tych komend; nie każdy katalog projektu jest repozytorium.

Koordynator przed zależną rundą ustala per repo: identity/source, role read/write,
base, target branch, checkout i jego przypisanie do featura. Źródło bez dostępu lub
niejednoznaczny pin blokuje zależne zapisy, nie niezależne taski. Baza z planu ma
być obecna i zgodna; zmiana wymaga uzasadnienia w istniejącym zakresie albo decyzji.
Brak child checkoutu: agent przygotowuje worktree, ewentualnie izolowany klon.
Domyślnie jego fizyczny katalog jest wewnątrz parenta, w prywatnym, nieśledzonym
katalogu zadania (np. `.feature-repos/<feature-id>/<repo-id>`), bez symlinków po drodze.
Przed utworzeniem agent sprawdza brak kolizji i dodaje wyłącznie dokładny katalog
zadania do pliku wskazanego przez `git rev-parse --git-path info/exclude`, zachowując
zastane wpisy; nie zmienia śledzonego .gitignore. Ten plik może być wspólną metadaną
Git: nie kasować go ani nie zastępować całości. `git check-ignore` i status parenta
potwierdzają ignorowanie; konfigurację/dirt początkowy zapisujemy po przygotowaniu,
nie próbujemy commitować child repo/aliasu ani ukrywać innych zmian użytkownika.
Submodule pod śledzonym gitlinkiem pozostaje śledzony: nie ignorujemy gitlinku,
a jego zmiana jest osobnym elementem scope/receipt parenta.
Reuse wymaga dowodu tego samego featura i zgodności bazy/brancha/dependencies;
nazwa brancha sama nie świadczy o własności. Domyślna nazwa jak parent; kolizja
z inną pracą daje nową nazwę i zapis mapowania, nigdy reset/przejęcie. Zastany dirt
jest zinwentaryzowany; cudze zmiany zostają. Nie używamy globalnego clean/reset.

Wspólny checkout, inny feature albo główny checkout nie może być celem zapisu.
Dotyczy to także node_modules/local packages, build outputs i git hooks. Naprawa
powiązań tylko w środowisku własnego zadania. Wspólne metadane Git i zwykły cache
nie są same w sobie naruszeniem. Read-only repo wolno współdzielić tylko gdy również
uruchamiane komendy go nie modyfikują. Nie udajemy statycznej analizy dowolnego skryptu:
przy nieustalonym celu zapisu wstrzymujemy tę komendę i ustalamy go przed startem.
Submodule to odrębne repo: uwzględniamy gitlink/base i checkout detached, tworzymy
własną gałąź/checkout zadania; nie przestawiamy wspólnej konfiguracji/innego worktree.

## Mapowanie i kontrakt bridge

Mapa logiczna, branch/base/target, bindings i wnioski znajdują się w istniejącym
ledgerze. Lokalne ścieżki absolutne i fakty właściciela zapisujemy w ignorowanym
checkpointcie pod per-worktree exchange namespace; bez sekretów i bez drugiego
statusu zadania. Każde wznowienie odczytuje ten checkpoint i sprawdza realroot,
gitdir, branch, tożsamość repo i bindings. Zmienione elementy wymagają powtórzenia
odpowiednich kontroli; brak checkpointu wymaga odtworzenia z dowodów, nie klonowania
kolejnego zestawu na ślepo. Minimalny dowód reuse: wcześniejszy ledger/manifest
identyfikuje repo, feature, branch i bazę, a rzeczywisty checkout/commity/ancestry
potwierdzają tę relację, bez konfliktu z cudzą pracą. Sama nazwa lub wspólne remote
nie wystarcza; przy braku dowodu blokujemy jego użycie do zapisu i wyjaśniamy własność.
Nie wykonujemy pełnego audytu przed każdym narzędziem.

MCP nadal używa repo-relative globs. Każdy write child ma jednoznaczny dostęp spod
parenta: istniejącą ścieżkę albo lokalny ignorowany alias do własnego checkoutu.
Nowe checkouty domyślnie leżą fizycznie pod parentem. Zewnętrzny alias jest
wariantem reuse/niestandardowego układu dopiero po wykazaniu dostępności dla obu ról.
Alias można utworzyć w prywatnym katalogu parenta, tylko gdy nie koliduje z plikiem,
repo ID lub cudzym środowiskiem. Zewnętrzne worktree pozostaje poza parentem;
alias nie zmienia jego Git ani nie daje fizycznej ochrony lease. Nie wkładamy
absolutnych ścieżek ani `../` do scope. Kontrakt podaje zarówno alias/globs jak
zweryfikowane realpaths, mapowanie repo ID, bases, bindings i zakres per repo.
`changed_scope` to płaska tablica: ścieżki parenta plus child paths z prefiksem
jego aliasu. Dla submodule gitlink parenta i pliki child to dwa odrębne wpisy.
Nie polegamy na diff parenta dla ignorowanego child. Worker sprawdza mapę przed
zapisem i nie dopisuje nowych repo bez kontraktu. Obie role ładują wspólną procedurę.
Uprawnienia klienta są rzeczywistym ograniczeniem: runner ma acceptEdits oraz
--add-dir z prefiksów scope, manager własny sandbox/writable roots. Test argv
bez modelu dowodzi tylko przekazania katalogu, nie semantyki symlinków Edit/Write.
Zewnętrznego dostępu nie wolno uznać za PASS na tej podstawie ani zastępować odmowy
Edit/Write obejściem przez Bash. Bez dowodu wybieramy fizyczny lokalny checkout
przy pierwszym setupie; istniejącego zewnętrznego środowiska/sesji nie przenosimy
po cichu. Lokalny Git worktree może potrzebować zapisu do wspólnego gitdir poza
parentem; stosujemy zwykłe uprawnienia klienta/eskalację, nie wyłączamy sandboxa.
Gdy ich brak, nowy izolowany klon wewnątrz parenta jest alternatywą tylko jeśli
zachowuje autoryzowane źródło/bazę i nie zastępuje istniejącej pracy. Brak wszystkich
zgodnych wariantów blokuje zależne zapisy. To ograniczenie hosta, nie nowa bramka
produktowa ani obietnica całkowitego braku promptów polityki klienta.
W19 ma pogodzić to z wyborem wersji instrukcji; F-W20 nie tworzy własnego selektora.

## Dostawa i kontrola

Pierwsza linia zostaje dokładnie `DELIVERY=local-v1 ...` dla parenta. Druga linia
w kontrakcie multi-repo wskazuje `REPOS=<relative-json-path> SHA256=<hash>` przed
opisem; obie muszą zmieścić się w utrwalanym summary (4000 znaków). Nowy JSON jest
załącznikiem nowego ledgera parenta, commitowanym w tej samej rundzie.
Wyjątek local-delivery dla commitu ledgera po kontrolach obejmuje także ten
załącznik (wyłącznie dowody, bez kodu). Kiedy jawnie wymagano ZIP, kolejność to
DELIVERY, REPOS, PACKAGE; odbiorca sprawdza wszystkie linie przed opisem oraz
limit 4000 znaków, nie skraca krytycznych referencji. Single-repo zachowuje swoją
kolejność DELIVERY, PACKAGE. Zbyt długie referencje trzeba skrócić w planie ścieżek,
a nie obcinać hash lub po cichu pomijać wymaganą paczkę. Zawiera wersję
`multi-repo-v1`, logiczne ID i source identity, alias, base/head child, branch/target,
zakresy, baseline/final dirt z klasyfikacją własności i dowody testowanego zestawu.
Parent HEAD pochodzi z pierwszej linii, nie z wnętrza własnego commitu: bez cyklu
self-hash. Parent BASE/scope są w kontrakcie. Read-only dependencies mają identyfikację
sprawdzonych wersji, nawet gdy niczego w nich nie zmieniono.

Odbiorca porównuje manifest z kontraktem i własnym odczytem Git dla każdego repo:
identity/realroot, kompletność repo, base/head/ancestry, każdy commit i końcowy diff,
zmiany plików koordynatora, nowy ledger, dirt i wyniki integracji. Nie ufa gotowej
liście worker changed_scope. Manifest nie jest autoryzacją dowolnej ścieżki ani
komendy. Nowy JSON odczytuje z dokładnego parent HEAD i sprawdza hash. Własny albo
nakładający się niedokończony dirt w którymkolwiek repo daje PARTIAL z blockerem,
nie COMPLETE; znany obcy dirt rozliczony oddzielnie. Zmiana child po dostawie jest
dryfem integracji i wymaga osobnego sprawdzenia, nie przypisania workerowi.

W20-01 doprecyzuje pola/walidacje i fixtures w krótkim kontrakcie technicznym,
w tym kolizje aliasów, manifest poza kontraktem, readonly dependency drift,
single-repo fallback i transport DELIVERY/REPOS/PACKAGE. Próby obejmują argv
runnera dla fizycznego child i zewnętrznego aliasu, ignore/status, rzeczywistą
lokalizację gitdir submodule w linked worktree oraz zmiany wspólnego configu
przy init. Te normalne metadane odróżnić od nieautoryzowanej zmiany checkoutu. To lokalna bramka techniczna przed
konsumentami, bez nowego pytania użytkownika. Wymóg zmiany runtime/API zamiast
opisanej zgodności wymaga konkretnego wykazania i oceny zakresu, nie cichego rozszerzenia.

## Integracja, walidacja i granice

Koordynator integruje lokalnie zgodny zestaw feature HEADs i testuje go przed merge.
Późniejsze autoryzowane merge odbywa się dependency-first do target branch każdego
repo; aktualizuje piny do rzeczywistych wynikowych SHA i zapisuje delivery→integration.
Przerwanie zostawia per-repo wynik i dokładny kolejny krok, bez resetu częściowo
scalonych repo i bez udawanej atomowości. Po merge innym niż FF oraz zmianie pinów
ponownie sprawdzamy wynikowy zestaw SHA; commit pinów oceniany oddzielnie jako
dryf integracji, a wcześniejszych testów nie przypisujemy nowym bajtom. Cykliczne zależności wymagają jawnego
zestawu kompatybilnych wersji i kolejności etapowej. Push/deploy pozostają osobne.
ZIP jawnie wskazuje pokryte repo; nie rozszerzamy eksportera do nowego formatu.

Kolejność: W20-01 kontrakt + próby na syntetycznych repo → W20-02 procedura/helper
oraz role → W20-03 integracyjne scenariusze i dokumentacja/review. Własność shared
files sekwencyjna; osobny reviewer read-only, nie równoległe edycje tych skilli.
Koordynator odpowiada za całe AC-01…10, wykonawca za lokalne taski/ledgery.
Testy obejmują izolację klon/worktree/submodule, kolizje, symlinki i dependency writes,
resume/drift, multi-repo receipt oraz przerwany merge na jednorazowych repo.
Kontrole generowanych paczek, dokumentacji, build, npm test i obie suite Python.
Syntetyczne testy/helpery nie dowodzą samodzielnego zachowania modeli. Nie planujemy
pilota modeli nowej funkcji jako wymagania briefu; ograniczenie ma pozostać w raporcie.
Niezależne review instrukcji obejmie decyzje agentów dla tych samych scenariuszy.

F-W19 nie blokuje implementacji. Bez jego dostawy publikacja wymaga wydania bridge'a
oraz upgrade; po F-W19, jeśli zgodność silnika potwierdzona, możliwe workflow-only.
Publikacja i aktualizacje realnych projektów poza proponowanym wykonaniem F-W20.
Nie zmieniamy produkcyjnych repo użytkownika ani aktywnych runtime. Przy scalaniu
F19/F20 zachować obie zmiany shared skills/generator; walidować finalny wspólny stan.

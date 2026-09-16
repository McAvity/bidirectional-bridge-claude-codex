# Wave14 — pluginy i praca bez ręcznego init worktree

Status: ZAPLANOWANE; implementacja niezlecona. Data: 2026-09-16.
Baza planowania: feature-workflow `6795703`. Wave12 odebrane; wave13 w realizacji
według użytkownika. Postęp: [wave14-progress.md](wave14-progress.md).

## Cel i doświadczenie użytkownika

1. Raz na komputerze użytkownik instaluje plugin Bridge z naszego marketplace.
2. W nowym projekcie otwiera zwykłe codex i zleca włączenie bridge’a skillem.
   Skill przygotowuje minimalne ustawienia projektu w ramach tego zlecenia.
3. Tworzy kolejny worktree w Herdr lub Git, otwiera codex i zleca feature.
   Nie wykonuje ręcznie node scripts/bridge.mjs init ani nie kopiuje konfiguracji.
4. Astra prowadzi Claude’a, review i poprawki według istniejącego workflowu.
   Aktualizacje nie przełączają działających sesji ani rozpoczętych featurów.

Branch nie jest worktree: zmiana brancha w tym samym katalogu nie tworzy nowej
instalacji. Zmiana projektu/worktree wymaga odrębnego stanu, ale jego przygotowanie
ma być automatyczne. Zachować zasadę jednej aktywnej Astry/featura na worktree.

## Zależności i rozpoznanie przed implementacją

Oprzeć się na wave12 (przypięte runtime, init/update/rollback/doctor, setup-layout)
i odebranym interfejsie wave13 (logi/diagnose). Nie kopiować narzędzi pilota jako
produktu ani przebudowywać aktywnych runtime. Przy starcie ustalić aktualną bazę;
nie scalać trwającej pracy wave13 bez uzgodnienia. Rozpoznanie formatów pluginów
może toczyć się niezależnie; wspólny wynik wymaga testów po integracji wave13.

Najpierw przeprowadzić trzy małe próby bez modeli na wspieranych klientach:
- plugin MCP otrzymuje właściwy katalog projektu/worktree, także przy zewnętrznych
  worktree Herdr, ścieżkach ze spacjami i uruchomieniu z podkatalogu;
- delegowany claude -p ma właściwy, kompletny zestaw instrukcji wykonawcy bez
  ręcznej instalacji pluginu lub kopiowania plików w każdym projekcie;
- aktualizacja/cache pluginu nie usuwa wersji potrzebnej trwającej sesji i nie
  miesza nowych instrukcji ze starym runtime; sprawdzić też restart klienta.

Zbadać lokalne CLI i aktualną oficjalną dokumentację. Zgodność tożsamości bridge’a
jest obecnie potwierdzona dla Codex 0.154.0; dostępność funkcji pluginów nie oznacza
zgody na ominięcie tego guarda. Jeśli inna wersja hosta jest niezbędna, przedstawić
konkretną zależność i zakres testów adaptera. Nie obiecywać potwierdzonego zachowania
na podstawie samego formatu manifestu.

## 1. Jeden produkt, dwa pakiety integracyjne

Wspólny runtime, wersje, instrukcje workflowu i testy; generowane lub składane dwa
pakiety dystrybucyjne z manifestami dla Codexa i Claude Code. Bez ręcznego utrzymywania
rozbieżnych kopii skilli. Pakiet dostarcza integrację MCP i dostęp do instrukcji,
nie bazę projektu. Runtime nie zapisuje stanu w cache pluginu.

Priorytetem jest Codex jako manager i Claude jako delegowany wykonawca. Instalacja
pluginu Codexa ma wystarczać do przygotowania wykonawcy przez bridge; nie wymagać
od użytkownika drugiej instalacji tylko po to, by Astra mogła delegować.
Pakiet Claude Code umożliwia natywne używanie istniejących ról/skilli w tym kliencie.
Nie projektować przy okazji nowej odwróconej pętli featura ani nowych uprawnień delegacji.

Marketplace to wersjonowany katalog pluginów w naszym repo lub osobnym małym repo
wybranym przy wykonaniu. Zacząć od własnego źródła dodawanego przez użytkownika;
obecność w oficjalnym katalogu OpenAI/Anthropic nie jest kryterium odbioru.
Wybrać minimalną odtwarzalną paczkę i proces wydania, zachować MIT i pochodzenie.
Nie wymagać npm publish, jeżeli dystrybucja repo/artefaktu wystarcza. Instalacja pluginu
nie może zakładać, że sam marketplace automatycznie dobuduje zależności Node.

## 2. Włączenie projektu i automatyczne przygotowanie worktree

Udostępnić jeden łatwy do wywołania skill, roboczo bridge-setup, lub rozszerzyć
istniejące wejście. Użytkownik daje zwykłe zlecenie używania bridge’a w projekcie;
nie potrzebuje wielowierszowego promptu ani wiedzy o ścieżkach runtime.

Minimalna deklaracja projektu może określać włączenie i przypiętą wersję. Ma być
przenośna i dziedziczona przez nowe worktree wraz z Git. Oddzielić ją od lokalnego
rekordu instalacji, tożsamości, sesji i baz. Nie współdzielić lokalnego stanu przez
common gitdir. Brak deklaracji w starszym branchu nie uprawnia do zgadywania zdalnego
stanu lub cichego włączenia; skill może przygotować ten projekt w ramach zlecenia.

Po pierwszym autoryzowanym użyciu w nowym worktree deterministycznie rozpoznać root,
gitdir i wybraną wersję, sprawdzić zgodność oraz idempotentnie przygotować własny stan.
Dwa jednoczesne pierwsze użycia nie mogą nadpisać konfiguracji ani przejąć managera.
Wykorzystać istniejące mechanizmy init i bindingu, nie tworzyć alternatywnej bazy.
Nie traktować skopiowanego .bridge jako świeżej instalacji i nie adoptować go automatycznie.

Samo wykrycie pluginu, handshake lub odczyt nie przypisuje managera i nie tworzy
stanu domenowego. Zapis konfiguracji/bindingu jest następstwem zleconego użycia,
po walidacji workspace i tożsamości. Odmowa obcego managera zachowuje brak mutacji,
również w logach wave13. Start bez deklaracji powinien umożliwiać setup, nie blokować
całego Codexa błędem required MCP. Usunąć potrzebę ręcznego init, nie ukrywać jej
za automatycznym uruchamianiem dowolnego skryptu przy każdym otwarciu katalogu.

Obsłużyć Herdr bez wymagania zmian w Herdr i bez zależności od jednej ścieżki domowej.
Hook startowy tylko jeśli próba dowiedzie jego potrzeby; preferować prostsze
rozwiązanie w pluginie/launcherze i jawnej operacji setupu.

## 3. Skille i konfiguracja poza kodem projektu

Ogólne skille, helpery i runtime dostarczać z instalacji pluginu/przypiętego zestawu.
W repo docelowym pozostają dokumenty jego featurów, wymagania, decyzje i mała
konfiguracja projektu. Zachować możliwość własnych instrukcji oraz jawnych nadpisań.
Przenieść zależności od literalnych ścieżek .agents/skills/... na odwołania działające
z pakietu; dotyczy to także eksportera feature-exchange i referencji docs/features.
Nie wystarczy zapakować obecnych plików ZIP-em i zostawić niedziałające odsyłacze.

Dla Claude’a uruchamianego przez bridge jawnie zapewnić instrukcje wybranej wersji,
poprawne cwd i istniejącą blokadę dalszej delegacji. Brak pluginu Claude’a w osobistym
profilu nie może uniemożliwiać trybu Astra → Claude. Testować instrukcje widziane
przez oba klienty; nie zakładać automatycznego dziedziczenia pluginów managera.

## 4. Wersje i aktualizacje

Instalacja pluginu na komputerze może być wspólna, ale projekt/worktree wybiera
kompatybilny zestaw runtime + instrukcje. Dostarczenie nowej wersji pluginu nie
przełącza tego wyboru automatycznie. Rozdzielić aktualizację dystrybucji od migracji
projektu. Niezmienne wersje potrzebne do wznowienia muszą przetrwać odświeżenie cache.

Ustalić jeden autorytatywny pin i opisać jego pierwszeństwo względem lokalnego wyboru
worktree oraz zmian brancha. Rozbieżność ma prowadzić do konkretnego komunikatu lub
bezpiecznej operacji aktualizacji, nie cichego użycia przypadkowego HEAD.
Instrukcje zarządzającego agenta również muszą odpowiadać wybranemu zestawowi:
rozważyć cienki stabilny skill wejściowy odczytujący właściwą wersję zamiast ładowania
zawsze najnowszego pełnego workflowu. Wybrać najprostszy sprawdzony wariant.

Aktualizacja i rollback korzystają z gwarancji wave12: brak przełączania aktywnego
runtime, brak cofania bazy ze starej kopii, jawna zgodność schematu/adaptera.
Usunięcie pluginu nie kasuje featurów, baz, paczek i dowodów; opisać pozostawione dane.

## 5. Migracja istniejących instalacji

Nowy projekt jest ścieżką domyślną, lecz obecne instalacje wave12 muszą działać do
jawnej migracji. Rozpoznać istniejący projektowy MCP i pluginowy MCP, żeby uniknąć
podwójnego serwera i konfliktu nazw narzędzi. Nie usuwać lokalnie zmodyfikowanych
skilli, ustawień, AGENTS.md ani CLAUDE.md. Przed migracją przedstawić plan/diff.

Zachować zgodny fallback CLI wave12 dla środowisk bez pluginów. Doctor pokazuje
źródło integracji, wybrane wersje i przyczynę konfliktu. Diagnose wave13 identyfikuje
wersję pakietu i faktycznie używany zestaw, bez rejestrowania sekretów.
Nie zmieniać logowania, rozliczeń, globalnego sandboxa ani polityki uprawnień.
Zaufanie projektu i wymagane zgody hosta pozostają jawne.

## Kryteria odbioru

| ID | Wymagany dowód |
| --- | --- |
| AC-01 | Własny marketplace pozwala zainstalować pakiety dla wspieranych klientów z odtwarzalnego źródła; bez zależności od checkoutu autora. |
| AC-02 | Nowy projekt włącza bridge jednym zleceniem skilla, potem zwykłe codex udostępnia narzędzia i instrukcje bez flag MCP. |
| AC-03 | Nowy zewnętrzny worktree włączonego projektu działa bez ręcznego init; ma osobny stan, logi i paczki. |
| AC-04 | Astra deleguje do Claude’a z właściwymi instrukcjami bez ręcznego setupu wykonawcy w projekcie; zakaz dalszej delegacji zachowany. |
| AC-05 | Aktualizacja pluginu nie zmienia wersji używanej przez trwający feature; restart zachowuje wymagany zestaw runtime/instrukcji. |
| AC-06 | Handshake/odczyt/foreign refusal nie przejmują ani nie mutują stanu; równoczesne przygotowanie jest bezpieczne. |
| AC-07 | Migracja wave12 zachowuje dane i własne ustawienia, nie uruchamia podwójnego MCP; fallback CLI pozostaje dostępny. |
| AC-08 | Doctor/diagnose rozpoznają instalację i wersje; brak runtime lub zgodności ma czytelny następny krok, bez automatycznego obchodzenia guarda. |
| AC-09 | Instrukcja obejmuje instalację marketplace/pluginu, nowy projekt/worktree, aktualizację, migrację, rollback i usunięcie pluginu. |

## Walidacja i realizacja

Osobny branch/worktree, postęp przy istotnych checkpointach. Zacząć od trzech prób
wykonalności; ich wynik zapisać krótko w progress. Kontynuować realizację w udzielonym
zakresie bez osobnych bramek na każdy dokument. Stosować reguły wave11: wąskie korekty,
konkretny związek blokera z celem i uproszczenie przy nawrocie problemu.

Bez modeli: walidacja manifestów, odtwarzalność pakietu, instalacja z lokalnego
marketplace, start prawdziwego MCP, odkrywanie instrukcji, dwa zewnętrzne worktree,
ścieżki ze spacjami, brak deklaracji, podkatalog, równoczesny bootstrap, update cache,
brak starej wersji, przerwany setup, konflikty migracji, symlinki i ochrona cudzych plików.
Nie modyfikować osobistego profilu podczas tych prób: izolowane konfiguracje testowe.
Wykonać testy wymagane przez AGENTS i testy integracji z odebranym wave13.

Po przygotowaniu zaproponować krótki realny smoke: instalacja pluginu, nowe repo,
nowy worktree bez init, zwykły Codex i jedna delegacja do Claude’a. Osobna zgoda na
konkretny zakres/budżet; plan sam modeli nie uruchamia. Nie powtarzać całego wave10.
Oddzielić dowód działania obu formatów pluginu od rzeczywistej delegacji modeli.
Zachować lokalne dowody, publikować jedynie zanonimizowany raport. Publikacja pluginu
lub marketplace wymaga osobno autoryzowanej konkretnej operacji.

## Poza zakresem

Centralny serwer, supervisor, automatyczne wzbudzanie zamkniętej Astry, /goal,
obsługa wielu managerów we wspólnym worktree, zastępowanie Herdr, oficjalne katalogi
jako obowiązkowy kanał, nowy workflow odwróconych ról oraz automatyczne rozszerzanie
wsparcia wszystkich wersji klientów. Wave13 pozostaje właścicielem logowania/retencji.

## Materiały do ponownego sprawdzenia przy wykonaniu

- [Pluginy Codexa](https://learn.chatgpt.com/docs/plugins).
- [Pluginy Claude Code](https://code.claude.com/docs/en/plugins-reference).
- [Marketplace Claude Code](https://code.claude.com/docs/en/plugin-marketplaces).
- [Kontrakt setupu](../setup-layout.md), [instrukcja wave12](../setup.md),
  [plan wave13](wave13.md). Dokumentacja hostów może zmienić się po zapisaniu planu.

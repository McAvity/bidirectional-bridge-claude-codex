<!-- Migrated plan: references to experiments/ below describe historical inputs only.
They are not dependencies. See ../HANDOFF.md for current status and source mapping. -->
# Wave7 — fork, diagnostyka, równoległe feature’y i prosty setup

Status: W TOKU. Fork i import narzędzi ukończone; izolacja, diagnostyka i setup nadal do wykonania.
Zlecenie: zapisać plan. Pierwszy etap wykonania: przygotować i opublikować fork
bridge’a na GitHubie jako samowystarczalne repo projektu.

Aktualizacja integracyjna wave9: poprawka timeout/recovery została dostarczona i według
koordynatora przejrzana oraz wdrożona w osobnym przypiętym runtime. Zgłoszone recovery
zachowało task/sesję; późniejsze DONE dostawy nie zamknęło REWORK kontraktu.
To nie implementacja izolacji ani odbiór wave7. Dowody i ograniczenia:
[wave9 progress](wave9-progress.md). Aktywny worktree wave7 nie jest tu modyfikowany.

## Cel

Użytkownik instaluje sprawdzoną wersję w realnym projekcie, uruchamia zwykłe `codex`
i zleca feature. Może prowadzić równolegle kilka par Astra–Claude w oddzielnych
worktree. W razie problemu eksportuje dane wystarczające do diagnozy. Sam bridge
rozwijamy tak samo: branch/worktree na zmianę, ze źródłami i testami w GitHubie.

## 1. Fork na GitHubie i jedno źródło projektu — pierwszy etap

1. Ustalić konto/organizację docelową i nazwę repo, sprawdzić uprawnienia oraz
   możliwości faktycznego forka upstream. Nie tworzyć repo udającego fork bez
   zachowania historii. Zweryfikować widoczność i ograniczenia GitHub przed publikacją.
2. Punktem wyjścia jest historia `grizzly2005/bidirectional-bridge-claude-codex`
   oraz lokalny vendor `experiments/vendor/bidirectional-bridge` z poprawkami wave3–5.
   Zachować upstream jako remote, licencję MIT i informację o autorstwie.
   Nie publikować całego obecnego katalogu eksperymentów ani zagnieżdżonych klonów.
3. Przygotować czysty checkout forka i przenieść bieżące zmiany jako przeglądalne
   commity. Źródłami mają być normalne pliki, nie ZIP-y i patche wymagane do instalacji.
   Skille feature-workflow v4 przenieść z `experiments/wave5/workflow/`, zachowując
   ich względne odwołania i jedną kanoniczną kopię do dystrybucji. Ustalić jawnie,
   które skille służą rozwojowi bridge’a, a które są instalowane w projektach docelowych.
4. W repo przechowywać wszystkie elementy potrzebne do odtworzenia projektu:
   - kod bridge’a, schematy/migracje i lockfile zależności;
   - skille obu ról, szablony konfiguracji, instrukcje instalacji i aktualizacji;
   - testy jednostkowe/integracyjne, małe fixture’y, launchery i kolektory testowe;
   - plany, decyzje architektoniczne, opis ograniczeń i zanonimizowane raporty;
   - procedurę budowania wydania i manifest wersji komponentów.
5. Nie śledzić runtime DB, transkryptów, tokenów, osobistych ustawień, node_modules,
   prywatnego kodu realnych projektów i masowych surowych wyników. Dane testowe
   potrzebne do reprodukcji mają być syntetyczne lub jawnie przygotowane do publikacji.
   Artefakty wydań generować ze źródeł; nie utrzymywać kilku ręcznych kopii skilli.
6. Uogólnić ścieżki `<local-workspace>`, profile hosta i nazwy kont. README ma opisywać
   fork i różnice względem upstream. Stary manifest certyfikacji vendora nie może
   przedstawiać zmodyfikowanych plików jako wcześniej certyfikowanych: zaktualizować
   go na podstawie realnych kontroli albo jasno wycofać takie oznaczenie.
7. Sprawdzić świeży klon: build, testy, przygotowanie lokalnego projektu testowego.
   Dodać CI bez sekretów; płatne testy modeli pozostają osobnym jawnym krokiem.
8. Dopiero po przeglądzie publikowanych plików utworzyć/wypchnąć fork i podać URL,
   commit bazowy i instrukcję klonowania. Nie publikować pakietu do rejestru tylko
   dlatego, że opublikowano repo. Konto/nazwa są danymi do ustalenia przy wykonaniu;
   ten zapis planu sam nie uruchamia żadnej operacji GitHub.

Odbiór etapu: świeży klon z GitHuba wystarcza do rozwoju i lokalnego build/test;
żaden niezbędny plik nie zależy od starego workspace, prywatnego ZIP-a ani linku
symbolicznego prowadzącego poza repo. Zachowane historia upstream i informacje licencyjne.

## 2. Rozwój bridge’a na wielu branchach

- Jedna zmiana = osobny branch i worktree. Wykonawcy nie przełączają branchy w jednym
  współdzielonym katalogu. Do czasu potwierdzenia izolacji nie uruchamiać wielu
  managerów w jednym worktree.
- Przed pracą ustalić granice zmian, zależności, współdzielone schematy i integratora.
  Nie zlecać równoległej edycji tego samego pliku bez uzgodnionego sposobu integracji.
- Każdy branch ma zapis postępu, testów i następnego kroku; przekazanie wskazuje
  commit/snapshot i zakres. Zmiany wracają przez review i test integracji.
- Przypinać wersję bridge’a używaną do prowadzenia wykonawców. Nie uruchamiać
  aktywnych rund na zmieniającym się buildzie z brancha, który Claude właśnie edytuje.
  Bieżące stabilne wydanie prowadzi prace nad następnym.
- Domknięcie testu korekty z wave6 nadal należy do obecnego wykonawcy. Nie edytować
  jego plików równolegle. Włączyć zaakceptowany wynik osobnym commitem po zakończeniu;
  przeniesienie repo nie oznacza zgody na automatyczne dołączenie nieprzejrzanych zmian.

## 3. Izolacja wielu par Astra–Claude w projektach docelowych

- Wariant v1: jeden aktywny feature i jedna aktywna Astra na worktree, z własnym
  stanem bridge’a, paczkami i logami. Osobne projekty również mają osobny stan.
- Wprowadzić trwałe powiązanie: projekt → worktree → feature → manager → task/runda
  → próba → natywna sesja Claude’a. Nazwa brancha nie jest tożsamością worktree.
- Obecny właściciel `codex` identyfikuje rolę, nie sesję managera. Zaprojektować
  wykrywanie/blokowanie drugiego managera tego samego featura/worktree i jawne
  przejęcie przy wznowieniu, bez mylenia restartu z nowym właścicielem.
- Wznowienie wybiera dokładnie przypisaną sesję Astry; nigdy „najnowszą z cwd”,
  nigdy guardiana/auto-review. Przy niejednoznaczności błąd z instrukcją rozwiązania.
- Stan .bridge nie może być współdzielony lub kopiowany przypadkiem pomiędzy
  worktree. Skille i konfiguracja muszą być obecne także w nowym worktree.
- Ustalić oddzielne katalogi wymiany, porty i testowe bazy, gdzie wymaga tego projekt.
  Uwzględnić wspólne limity runtime/subskrypcji; brak cichego zastępowania sesji.
- Merge wyników featurów jest osobnym etapem integracji z testami wspólnego wyniku.

## 4. Diagnostyka do realnego użycia

- Wykorzystać istniejące zdarzenia SQLite, próby, telemetrykę, ledgery i artefakty.
  Uzupełnić brakujące zdarzenia, nie tworzyć drugiego konkurencyjnego źródła stanu.
- Zapis: wersje bridge’a/skilli/runtime, konfiguracja bez sekretów, powiązania sesji,
  czas start/koniec, request/correlation ID, timeouty, błędy, kody zakończenia i
  stan operacji. Rozróżniać timeout klienta od zakończenia wykonawcy.
- Logowanie działa bez dodatkowych komend użytkownika, również przy zwykłym `codex`.
  Nie zanieczyszcza stdout protokołu MCP; ma rotację i określoną retencję.
- Jedno polecenie diagnostyczne eksportuje konkretny feature lub incydent:
  spójny snapshot SQLite (z uwzględnieniem WAL), zdarzenia, wersje, logi błędów,
  wskazane dowody i czytelną chronologię. Eksport nie uruchamia agentów ani recovery.
- Domyślny pakiet minimalizuje dane prywatne. Pełne transkrypty/kod są opcjonalne,
  z listą zawartości do obejrzenia przed udostępnieniem. Nie obiecywać doskonałej
  automatycznej redakcji sekretów. Oryginały pozostają lokalnie.
- Dołączyć instrukcję analizy paczki przez agenta, z rozróżnieniem faktów i hipotez.

## 5. Dystrybucja i setup

- Pierwsza dystrybucja: wersjonowane wydanie forka, instalowane bez ręcznego
  nakładania patchy. Sposób dostarczenia (pakiet Node lub artefakt release) wybrać
  na podstawie najmniejszej liczby kroków i możliwości odtworzenia wersji.
- Projektowany interfejs (nazwy do potwierdzenia): `bridge init`, `bridge doctor`,
  `bridge diagnose`, opcjonalnie `bridge resume`/pomoc w utworzeniu worktree.
- `init` składa lokalną konfigurację MCP, skille oraz ignore’y; jest idempotentny,
  pokazuje diff, zachowuje niezależne ustawienia i lokalne modyfikacje skilli.
  Aktualizacja ma kontrolę wersji i ścieżkę wycofania, bez utraty runtime state.
- Docelowe uruchomienie: `cd <worktree>` i `codex`. MCP startuje z konfiguracji
  projektu; nie potrzeba osobnego ręcznie utrzymywanego serwera ani wielu flag.
  Skrypt startowy pozostaje fallbackiem tylko dla ograniczeń potwierdzonych testem.
- Zaufanie projektu, logowanie i uprawnienia poleceń wyjaśnić w preflight, nie obchodzić
  ich niejawnie. Brak sekretów w GitHubie i brak narzuconego osobistego profilu/modelu.
- `doctor` sprawdza wersje, zależności, dostępność narzędzi, konfigurację workspace,
  zapisywalność logów i stanu oraz ryzyko podwójnego managera, bez płatnej rundy.

## 6. Test odbiorczy wydania

1. Świeży klon forka i instalacja do projektu bez ścieżek starego workspace.
2. Start zwykłym `codex`: skille i bridge dostępne, logi tworzą się automatycznie.
3. Dwa feature’y na różnych branchach/worktree, dwie Astry i dwie sesje Claude’a
   równolegle. Brak mieszania kontraktów, odpowiedzi, plików, baz, paczek i logów.
4. Restart jednej Astry podczas waiting_user; druga para nadal pracuje. Wznowienie
   dokładnie właściwej sesji, bez duplikatów i bez wyboru guardiana.
5. Drugi manager tego samego worktree jest wykryty; nie zaczyna cichej równoległej pracy.
6. Kontrolowany błąd/timeout; paczka diagnostyczna pozwala odtworzyć chronologię
   bez dostępu do pierwotnej rozmowy użytkownika i bez modyfikacji stanu.
7. Update/reinstall zachowuje konfigurację użytkownika i stan featurów. Integracja
   wyników osobnych branchy przechodzi wymagane testy.
8. Wynik testu korekty wave6 włączony i jawnie rozliczony przed oznaczeniem wydania
   jako sprawdzonego dla pełnej pętli. Brakujące testy nie są PASS.

## Poza zakresem

Supervisor osieroconych procesów, automatyczne wzbudzanie zamkniętej Astry, /goal,
centralny serwer wielomaszynowy, wiele managerów współdzielących jeden worktree
oraz publikowanie prywatnych danych z realnych projektów. Wykrywanie problemu
procesu nie oznacza automatycznej zgody na jego zabicie lub reset sesji.

## Kolejność i checkpointy

Najpierw etap 1: fork z odtwarzalnym źródłem. Potem ustalenie tożsamości/izolacji
(etapy 2–3), na tej podstawie diagnostyka i setup (4–5), na końcu odbiór (6).
Po ustaleniu wspólnych interfejsów oddzielne branche mogą realizować diagnostykę
i instalator równolegle. Przed każdym przekazaniem aktualizować PROGRESS.md;
po wykonaniu zapisać REPORT.md z URL forka, commitami, wersją wydania i dowodami.

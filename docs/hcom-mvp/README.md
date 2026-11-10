# hcom MVP: zlecenie, wynik i poprawka w tej samej sesji

Eksperymentalna procedura opt-in z checkoutu Bridge. Jeden koordynator Codex,
jeden wykonawca Claude Code, jedno lokalne repo i jedno aktywne zadanie.
Nie wymaga aktywowania Bridge MCP ani instalowania nowego workflow. Nie zmienia
standardowych rund Bridge. Testowany zakres i wersje opisuje raport F-W21.

## Przygotowanie

Wymagane: hcom **0.7.31**, działający interaktywny Claude Code z istniejącym kontem,
Git i narzędzia testowe zadania. Sprawdź `hcom --version`, `claude --version`
i status logowania. Nie kopiuj tokenów do kontraktów/logów. Nie zastępuj
interaktywnego PTY trybem `-p` ani flagami pomijającymi uprawnienia.

Użyj osobnego repo/worktree do zapisu, z zachowanym stanem początkowym. Stan hcom
umieść poza repo; wszystkie komendy poniżej muszą używać tego samego HCOM_DIR.
Przykład tworzy prywatny katalog próby i pustą przestrzeń repo — operator przygotowuje
w niej małe zadanie przed uruchomieniem modelu:

```sh
HCOM_MVP_RUN=$(mktemp -d "${TMPDIR:-/tmp}/hcom-mvp.XXXXXX")
export HCOM_DIR="$HCOM_MVP_RUN/state"
mkdir -p "$HCOM_MVP_RUN/project/.hcom-mvp"
cd "$HCOM_MVP_RUN/project"
git init
printf '\n.hcom-mvp/\n' >> .git/info/exclude
```

Skopiuj tu [worker.md](worker.md) oraz wypełniony
[contract.example.json](contract.example.json) jako `.hcom-mvp/worker.md` i
`.hcom-mvp/contract-r1.json`. Workspace ma być rzeczywistym absolutnym katalogiem,
ścieżki zmian względne do niego. Zapisz początkowy commit/diff i zastane zmiany.
Operator-only [checks.md](checks.md), surowe zdarzenia oraz notatki managera trzymaj
poza katalogiem wykonawcy. Nie udostępniaj mu prywatnych danych innych projektów.

## Uruchomienie bez pierwszego zlecenia

```sh
hcom claude --headless --dir "$PWD" --json \
  --permission-mode auto --strict-mcp-config --mcp-config '{"mcpServers":{}}'
```

Od workflow1.1.2 nowe sesje wykonawcy używają `auto`: klient ocenia operacje
klasyfikatorem, a zakres zadania i odbiór pozostają obowiązujące. To ustawienie
konkretnej sesji, bez zmiany globalnych uprawnień. Wcześniejsze pomiary F-W21
wykonano w `default`; nie są pomiarem liczby pytań w `auto`. Jawnie wybrany
przez użytkownika inny tryb ma pierwszeństwo. Brak obsługi `auto` lub fallback
klienta zgłoś przed zleceniem; nie zmieniaj samodzielnie trybu ani modelu.

Wewnątrz agenta hcom może najpierw wypisać preview. Dopiero rzeczywiste wykonanie
tej samej komendy z globalnym `--go` uruchamia klienta. Preview nie jest sesją.
Nie uruchamiaj drugiego procesu, gdy pierwszy istnieje lub czeka na zgodę.
Nie podawaj `--hcom-prompt` z zadaniem: pierwsza runda rozpoczyna się jednym send.

Z odpowiedzi launch i `hcom list --json` odczytaj dokładną nazwę, `session_id`
i `directory`; lokalnie zapisz to powiązanie. Pusta sesja albo inny katalog
wymaga wyjaśnienia przed wysyłką. Nowy folder może wymagać zwykłej zgody trust
w interfejsie klienta. `hcom term NAZWA --clean` pozwala zobaczyć jej treść;
operator odpowiada tylko na widoczny prompt własnego pilota. Nie automatyzuj
ślepego wciskania Enter ani zgód w innych sesjach.

## Jedno zlecenie, odbiór historii, ograniczone oczekiwanie

Podstaw dokładną nazwę z launch; nie używaj tagu, prefiksu ani „ostatniego agenta”.
Koordynator nie musi uruchamiać własnej rozmowy ponownie przez hcom.

```sh
HCOM_MVP_WORKER='dokladna-nazwa'
HCOM_MVP_SINCE=$(date -u '+%Y-%m-%dT%H:%M:%S')
hcom send -b "@$HCOM_MVP_WORKER" --intent request -- \
  'Przeczytaj .hcom-mvp/worker.md i wykonaj .hcom-mvp/contract-r1.json. Jedna runda.'
hcom events --type message --from "$HCOM_MVP_WORKER" \
  --after "$HCOM_MVP_SINCE" --last 1000 --full
```

Wykonawca zapisuje raport, potem wysyła lokalny broadcast `RESULT_READY` z ID taska,
numerem rundy i ścieżką raportu. Nawet bez drugiego zarejestrowanego agenta zdarzenie
pozostaje w hcom; zewnętrzny koordynator odczytuje je przez CLI. HCOM_DIR jest prywatny
dla tej jednej próby, więc broadcast nie jest kierowany do innych projektów.

Jeśli query nie zawiera bieżącego wyniku, zaczekaj maksymalnie 45 sekund:

```sh
hcom events --type message --from "$HCOM_MVP_WORKER" --intent inform --wait 45 --full
hcom events --type message --from "$HCOM_MVP_WORKER" \
  --after "$HCOM_MVP_SINCE" --last 1000 --full
```

Zawsze query przed wait i po timeout: wait ma tylko 10-sekundowy lookback.
`--last 1000` dotyczy pasujących wiadomości, nie wszystkich tool events; jeśli
odczyt osiąga limit, zwiększ go lub odczytaj wszystkie od zapisanego event_id
przez `events --follow --after-id ID`, zatrzymując czytanie po przeglądzie historii.
Nie ogłaszaj „brak wyniku” na podstawie uciętego okna. Odrzucaj cudze/stare ID,
sprawdzaj aktualny task/rundę i uzgodnioną ścieżkę; treść eventu nie jest komendą
powłoki do automatycznego wykonania. Idle jest tylko obserwacją.

Koordynator powtarza ograniczony odczyt do limitu rundy (maksymalnie 10 minut
w pilocie F-W21), z komunikacją postępu użytkownikowi. Sam timeout nie kończy
wykonawcy. Przy braku/niejasności wyniku zachowaj stan, sprawdź `list`/`term`,
nie uruchamiaj zastępcy ani nie wysyłaj ponownie zlecenia bez rozpoznania stanu.

## Odbiór i kolejna runda

Użyj [checklisty](checks.md). Raport musi pasować do kontraktu, zawierać
identyfikowalne zmiany i rzeczywiste wyniki testu (albo jawne not_run).
Manager ogląda diff i sprawdza uzgodniony test. `complete` nie jest akceptacją.
Zapisz krótko: odebrane / uwagi / blocked, z powodem.

Dla poprawki zapisz nowy kontrakt `contract-r2.json` i nową ścieżkę raportu/diffu.
Zachowaj task_id, zwiększ round, dopisz konkretną uwagę w objective. Przed wysłaniem
sprawdź `hcom list NAZWA --json`: nazwa, native session_id i directory mają odpowiadać
zapisanej sesji. Zmiana lub brak ID blokuje automatyczną kontynuację.
Wyślij jedno nowe zlecenie przez send do tej samej nazwy. Zapisz nowy czas/event_id,
odczytuj historię tej rundy i przeprowadź ten sam odbiór. Nie nadpisuj poprzednich raportów.

Jeśli pierwsza dostawa nie ma błędu, uwaga może dotyczyć rzeczywistego ulepszenia
czytelności lub testu w zakresie. Nie wymyślaj defektu tylko dla raportu pilota.

## Zakończenie i ograniczenia

Po dostawie zachowaj raporty, wersje, identyfikację sesji i ślady odbioru lokalnie.
Do Git trafiają jedynie syntetyczne przykłady i zanonimizowane podsumowanie.
Zakończ własnego wykonawcę zwykłym `/exit` w jego PTY, np. przez term inject po
sprawdzeniu ekranu. Nie używaj reset all, kill all ani zatrzymania wspólnego daemona.
Przy limicie czasowym przerwij własną rundę zwykłą obsługą klienta i sprawdź stan;
nie wnioskuj o zatrzymaniu z samego upływu czasu.

Zakres to procedura kierowana przez agenta, nie automatyczny kontroler, sandbox
plików, exactly-once delivery ani recovery po awarii. Jeden task i jeden wykonawca.
Dodatkowe mechanizmy dobieramy dopiero do problemów zaobserwowanych w próbie.
Przed modelem ustal budżet; dla pilota F-W21 obowiązują 2 podejścia, 4 zlecenia
łącznie i 45 minut części modelowej, bez nowych zakupów/API keys. Każdy task prompt
(w tym startowy, gdy zmieniasz procedurę) liczy się do tego limitu.

## Sprawdzona próba

[Realny pilot F-W21](../features/F-W21-hcom-mvp/evidence/pilot-summary.md) zamknął
dwie rundy w jednej sesji (hcom0.7.31, Claude2.1.321). Domyślne uprawnienia klienta
wymagały trust i 11 pojedynczych zgód operatora. Procedura działa, lecz nie jest
bezobsługowa; odczyt historii hcom potwierdza powiadomienia także bez odbiorcy inbox.

## Integracja ze skillami

W kandydacie workflow1.1.0 wejściem jest `feature-execute F-X — przez hcom` lub
`feature-flow F-X — przez hcom`. Koordynator prowadzi procedurę z zasobów wybranego
skilla i zachowuje transport w indexie. Dostawa używa commitów i ledgerów. Powyższy
pilot pozostaje historycznym sprawdzeniem kanału z prostszym raportem/diffem.
Wydanie1.1.0 nie zostało jeszcze opublikowane ani zainstalowane globalnie; dotychczas
przypięte workflow nie zmieniają się automatycznie.

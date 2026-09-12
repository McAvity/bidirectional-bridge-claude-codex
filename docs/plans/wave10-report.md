# Wave10 — raport integracji i przygotowania pilota

Status: **KONTYNUACJA ZACHOWANEGO R1 PRZYGOTOWANA DO ZATWIERDZENIA**.
Oryginalny przebieg: STOP, częściowy wynik rzeczywistego pilota. R1 obu par wykonane;
pełny scenariusz niezaliczony po przedwczesnym zatrzymaniu przez operatora.
Cały wave10 pozostaje otwarty. Historyczne sekcje przygotowania poniżej zachowują
poprzednie dowody; aktualny wynik i punkt wznowienia są w końcowej sekcji raportu.
Data: 2026-09-12. Jedyna lista ustaleń i zamknięć: [wave10-progress.md](wave10-progress.md).

## Wejścia i dostarczone commity

Własny worktree potwierdzony przez pwd/Git: branch `wave10`, katalog worktree o tej nazwie,
czysty start `b040ca1ab5e9a22525671373aa7cff99e4bd7dfe`. Ten commit zawiera wymagany plan.
Odebrana izolacja: `wave7 @ 66e524f0e334b159ccd5fb3cd3606bf58e858a68`.
Aktualne opublikowane timeout/recovery: `feature-workflow @ b040ca1ab5e9a22525671373aa7cff99e4bd7dfe`
(nowsze od SHA w planie, zachowane). Wspólna baza: `aeb92c2f35670b73aa9e204f68f3734d2ad2cc37`.

| Commit lokalny | Dostawa |
| --- | --- |
| `2c9e9ddbb909b3db9f065466d60152a79316b31f` | Oczyszczony snapshot odebranej izolacji, integracja z timeout/recovery i regresja przez native dispatcher. |
| `e09ac17b44108135696f45d2926e8674a2d6eda6` | Protokół pilota, przygotowanie/handshake/snapshot oraz dostosowany test stdio timeout/restart. |
| `e099ca5414bdedb0fa7143ecca986a93f2d95361` | Nazwa pilot.py bez przesłaniania standardowego modułu Python, regresja bezpośredniego CLI. |
| `88bccc71d7e5e72ec1daeaf13922615aa28fab60` | Dokładne argumenty feature_run i eksportera w instrukcji. Historyczny pin runtime, zastąpiony harmonogramem v2. |

Końcowy commit dokumentacyjny zawiera ten raport, handoff/progress oraz usunięcie historycznej
nazwy z instrukcji operatora wymagane przez test przenośności. Nie zmienia kodu/builda runtime
ani launchera pilota. Lokalny `git log b040ca1..wave10` identyfikuje również ten commit.

Integracja używa trzystronnego połączenia delty wave7 na aktualnej bazie; nie zastępuje
orchestratora starszą wersją. Rzeczywiste konflikty rozwiązano w control-plane (lazy state
z zachowaniem evidence store) i tools (authority/onReserved wraz z recover_timeout/budżetami).
Guard działa przy dispatch, także replay, oraz ponownie w transakcji rezerwacji recovery.
Testy sprawdzają zachowanie tego samego taska/session handle, jedną nową próbę, restart,
jawne przejęcie i odrzucenie foreign/fenced/unsupported-host bez mutacji. Zachowano
wcześniejsze testy legacy adoption, waiting_user, migracji, locków i markerów; nie otwierano
ponownie pełnego review odebranego featura. To kontrola integratora, nie niezależne review.

## Oczyszczenie i mapowanie historii

Przed importem sprawdzono metadane author/committer/message oraz patche wszystkich 32
wyłącznych commitów wave7, również pośrednich. Publiczne adresy noreply; wykryte odnośniki
do dokumentacji są publicznymi źródłami, nie linkami sesji. Redakcja snapshotu objęła
prywatny katalog domowy operatora, rzeczywisty klucz katalogu wymiany i 11 identyfikatorów
historycznych runtime. Nie importowano DB, logów, surowych transkryptów, sesji, credentials,
konfiguracji osobistej ani odpowiedzi użytkownika; zachowano zanonimizowane decyzje i ledgery.
Hashe historycznych paczek i źródłowe SHA w ledgerach nadal wskazują oryginały, nie
oczyszczone bajty. Zachowano upstream ancestry i MIT notices.

To mapowanie **wielu commitów na zintegrowany snapshot**, nie deklaracja równoważności
każdego patcha. Historia i oryginalne bajty pozostają na wave7. Delty HANDOFF, wave7.md i
starszego docs/tasks/timeout-recovery nie zostały zaimportowane: ich aktualne opublikowane
wersje zachowano. Snapshot zawiera końcowy zaakceptowany kontrakt, implementację i kontekst.

| Źródłowy commit wave7 | Oczyszczony import/integracja |
| --- | --- |
| `e5cc93a43c2c9c2d127725048a65faa2050b1696` | `2c9e9ddbb909b3db9f065466d60152a79316b31f` |
| `3d9325f641ce6bed0e69eda3e7a19599e02eff41` | `2c9e9ddbb909b3db9f065466d60152a79316b31f` |
| `3f163f1161a2e58dc27d846c75d7602f0fa4655e` | `2c9e9ddbb909b3db9f065466d60152a79316b31f` |
| `1ff15d0dc8ce2e624a3caf8d86c61dbce288ccf8` | `2c9e9ddbb909b3db9f065466d60152a79316b31f` |
| `fe33aa06a4c28ad244be4ffc376c0806b686299d` | `2c9e9ddbb909b3db9f065466d60152a79316b31f` |
| `f978b69bc4cb70189d67c13d712e800f23ecf16a` | `2c9e9ddbb909b3db9f065466d60152a79316b31f` |
| `08d01c7353ed0673c4ef9c07247da42d2c02b1b7` | `2c9e9ddbb909b3db9f065466d60152a79316b31f` |
| `88d17073a58d8ac5d7e7e94acb91a3da725ec598` | `2c9e9ddbb909b3db9f065466d60152a79316b31f` |
| `80962dd876d25b07fc831526fe424f015a00693b` | `2c9e9ddbb909b3db9f065466d60152a79316b31f` |
| `0f9c03faf17dc32e4c92e190eca4dc7029e50c93` | `2c9e9ddbb909b3db9f065466d60152a79316b31f` |
| `a91bc0493e68eb87ffa758f7ff9e7a5499268c71` | `2c9e9ddbb909b3db9f065466d60152a79316b31f` |
| `75e0854838b70da523086af6a11bc575c7c84772` | `2c9e9ddbb909b3db9f065466d60152a79316b31f` |
| `17512076fa5556e6f493ecfdfc757a9fd2301366` | `2c9e9ddbb909b3db9f065466d60152a79316b31f` |
| `9f807c08b838c00d0a12aa1d7104a40bb42c17e2` | `2c9e9ddbb909b3db9f065466d60152a79316b31f` |
| `bc144c7db056d0b81787cbb73ad5a14791cd0b65` | `2c9e9ddbb909b3db9f065466d60152a79316b31f` |
| `d94c2dee56464863f42cae1cfd192e02f8108034` | `2c9e9ddbb909b3db9f065466d60152a79316b31f` |
| `19914a074fafa7228bbae066934e2b1f49833555` | `2c9e9ddbb909b3db9f065466d60152a79316b31f` |
| `da5fc87601fa0bcc39a0727fd2966070a6d97ad6` | `2c9e9ddbb909b3db9f065466d60152a79316b31f` |
| `511d7de6fe388113e13558840ac747f1e7045834` | `2c9e9ddbb909b3db9f065466d60152a79316b31f` |
| `f9bfcce59b5a87793ec83c655ba0da93bb1922c1` | `2c9e9ddbb909b3db9f065466d60152a79316b31f` |
| `1095c166dbd3fccfd940cd9e89c03ef6f9b05126` | `2c9e9ddbb909b3db9f065466d60152a79316b31f` |
| `3395f1ac4364ab8f981aa71e2787dd23a70548e7` | `2c9e9ddbb909b3db9f065466d60152a79316b31f` |
| `df54bb25f92386f39d43b4e1122e2488ae3abe8f` | `2c9e9ddbb909b3db9f065466d60152a79316b31f` |
| `117fd9f5a98aa66a8e8b0b0340d899f0f6b8ecf7` | `2c9e9ddbb909b3db9f065466d60152a79316b31f` |
| `1d872db6b58aa199c325aad7a2532877e754dd32` | `2c9e9ddbb909b3db9f065466d60152a79316b31f` |
| `d5ea3ca53dc9f1adc1fc4e2d1c2d7c7d9f2ffcd4` | `2c9e9ddbb909b3db9f065466d60152a79316b31f` |
| `61396c517e062704da93985da3f685ac9d3df077` | `2c9e9ddbb909b3db9f065466d60152a79316b31f` |
| `493430578d4d51b23b23d30da3bc285a6dbc443b` | `2c9e9ddbb909b3db9f065466d60152a79316b31f` |
| `cc2a73b757ee586fc9b660d591d0fef1d5f44bde` | `2c9e9ddbb909b3db9f065466d60152a79316b31f` |
| `4dea37c578f0aeaf25351dd53ca47dfba71d8ff0` | `2c9e9ddbb909b3db9f065466d60152a79316b31f` |
| `404bb4d69dc4a5e3945fc9b0252eed32542ae47b` | `2c9e9ddbb909b3db9f065466d60152a79316b31f` |
| `66e524f0e334b159ccd5fb3cd3606bf58e858a68` | `2c9e9ddbb909b3db9f065466d60152a79316b31f` |

Dodatkowe mapowanie lokalnego kandydata: `320ce4700ca9048565710535093515d98993a300`
→ `2c9e9ddbb909b3db9f065466d60152a79316b31f` (amend po redakcji identyfikatorów).
Sprawdzenie `git merge-base --is-ancestor` dla każdego z 32 źródeł i kandydata: wszystkie
odrzucone jako przodkowie wyniku. Nie przenoszono prywatnej historii przez merge.
Końcowe rev-parse potwierdza niezmienione wave7 i feature-workflow. Nie było push ani merge
do feature-workflow. Nie dotykano worktree/bazy/runtime wave7 i nie budowano głównego checkoutu.

## Walidacja pierwotnej integracji i ograniczenia

Poniższe pełne wyniki zachowano z integracji; dla korekty harmonogramu wykonano tylko
sprawdzenia zmienionych narzędzi i nowego przygotowania opisane na końcu raportu.

| Sprawdzenie | Wynik i zakres |
| --- | --- |
| npm ci --ignore-scripts | PASS w wave10 i osobnym runtime. |
| npm run build | PASS, Node 24.15.0; osobny build runtime również PASS. |
| npm test | **425/425 PASS**, 31 plików, po korekcie native metadata i explicit resume w teście stdio. |
| python3 -m unittest discover -s tests -v | **29/29 PASS**. |
| python3 -m unittest discover -s tools/pilot/tests -v | **115/115 PASS**, w tym 5 nowych testów bramek narzędzia. |
| Native stdio timeout/restart | **8/8 PASS** w pliku native-launcher; rzeczywisty transport/runner, atrapa Claude CLI. |
| Finalny pinned MCP handshake | **2/2 PASS równolegle**, 35 narzędzi każdy, caller codex/delegation allow, manager unbound, brak utworzenia .bridge. |
| Pinned preflight i prepared snapshot | PASS; host Codex CLI 0.154.0, Claude CLI obecny, oddzielne worktree/namespace. |
| Export/verify przygotowanych fixture A i B | PASS, identyczne r1.zip w oddzielnych katalogach smoke; **bez modeli i bez realnych rund**. |
| git diff --check / ancestry / wejściowe branche | PASS. |
| Realne pary Astra–Claude / niezależne review / CI | **NOT RUN**. |

Python w tej maszynie to 3.12.3; 3.11 nie był dostępny. npm zgłasza 5 podatności zależności
(4 moderate, 1 high); nie rozszerzano zakresu na aktualizacje. Nie potwierdzono limitów
75/90 minut ani 200/256 tur empirycznym pilotem. Ścisły adapter hosta dopuszcza dokładnie
Codex 0.154.0; handshake klienta SDK nie dowodzi jeszcze metadanych prawdziwej Astry.
Izolacja chroni przed przypadkowym pomieszaniem lokalnych sesji, nie złośliwym procesem
tego samego użytkownika. EOF może wymagać jawnego resume_instance; instrukcja to obejmuje.
Testy atrap nie są zaliczonym pilotem modeli, odbiorem całego wave10 ani poprzedniego REWORK.

Pełne logi zachowane lokalnie w `$RUN/evidence/validation`; do Git trafiają tylko wyniki/hashe.

| Log | SHA-256 |
| --- | --- |
| `wave10-js-tests.log` | `ba55fe3afe5afb9f6a104b6b3219329f324d7ea21917557dd8c51db700e05d8d` |
| `wave10-exchange-tests.log` | `06121e046f79ceef502461d46a1ec85b6feaeb4955b394e817259bd90001c503` |
| `wave10-pilot-tests.log` | `4defb6295e8147d5bed3731b8b3e75d5bd319dc9b16735672c881a7331b6f296` |
| `wave10-native-tests.log` | `271c3350b3ee894478456d42837ae081459a37ef3b96a2d54f14cd6e5692fe17` |

## Harmonogram v2 po review koordynatora

Koordynator zgłosił brak nowych problemów integracji i niezależny PASS 36 testów
izolacji/recovery/launchera oraz preflight. Bieżąca korekta dotyczy wyłącznie W10-08
w [jednej liście ustaleń](wave10-progress.md); nie wykonano ponownego review implementacji.
Poprzedni pilot na 88bccc7 jest zachowany jako historyczne przygotowanie, **nie do startu**.

Po r1 i review obie pary czekają w waiting_user/q1. Najpierw foreign probe przy braku
aktywnych rund; następnie B/r2 z bramką. Podczas tej aktywnej próby operator zamyka i
wznawia dokładną Astrę A, potwierdza q1, przekazuje odpowiedź i uruchamia A/r2. Po markerze
startu workera A niezwłocznie zwalnia B. Nie czeka na zakończenie ani review rundy A.
Oba rzeczywiste workery mają udokumentowany overlap w r2; r1 nie wymaga synchronizacji.

| Budżet do zatwierdzenia (scope wave10-two-pairs-v2) | Wartość |
| --- | --- |
| Rundy Claude’a | 4 łącznie, do 12 tur każda; zero retry i dodatkowego recovery. |
| A/r1, A/r2, B/r1 | Każda do 480000 ms (8 min). |
| B/r2 | Do 1200000 ms (20 min). |
| Bramka wyłącznie B/r2 | 540 s, Bash timeout 600000 ms. |
| Operator od gate-ready B do restartu/startu A i release B | 480 s, czyli 60 s rezerwy przed gate expiry. |
| MCP | tool_timeout_sec=1320 (22 min), startup 30 s. |
| Cały pilot | 60 min; start B/r2 najpóźniej w 30. minucie, min. 10 min na końcową ocenę/dowody. |
| Astry | Do 10 tur na parę, plus 2 tury osobnej Astry foreign-probe (bez Claude’a). |
| Modele/rozliczenie | Astra gpt-6-astra/high, Claude profil opus/high runnera; tylko potwierdzone subskrypcje, 0 USD dodatkowych wywołań API. |

Spójność: start B 120 s + gate 540 s + praca 480 s + zapas 60 s = 1200 s rundy;
MCP dodaje 120 s na zakończenie/transport. Operator liczy tury i pilnuje czasu także
wewnątrz TUI; launcher nie zabija procesów po końcu budżetu. Gate-ready po 120 s,
brak restartu/startu A/release w 480 s, koniec całego budżetu lub timeout => STOP,
bez dodatkowej rundy/resetu/recovery. Niedostępne koszty Astry pozostają unknown.

Instrukcja terminali i dokładne kroki:
[OPERATOR.md](../../tools/pilot/wave10/OPERATOR.md). Nowe prepare zapisuje START-A/B.txt
(r1 bez bramki), ROUND2-A/B.txt (osobne deadline i kolejność), manifest oraz niezatwierdzony
approval.example.json. Stary scope/budżet nie przechodzi preflight/approval.

Commit korekty i nowy pin runtime: **`406f0e1eb9e0ed494207589a82665bfd83741b1d`**.
Przygotowany katalog: **`/tmp/wave10-pilot-406f0e1`**, worktree `a` i `b`, runtime
w osobnym detached checkout `runtime`. Poprzednich katalogów nie używać do startu.

Weryfikacja korekty: 9/9 testów narzędzia, portability 1/1, npm ci/build nowego runtime
PASS, 2/2 równoległe rzeczywiste handshake MCP PASS (35 narzędzi, no-state), preflight
oraz prepared snapshot PASS. Sprawdzono wygenerowane START/ROUND2, limity manifestu,
brak approval.json, brak .bridge/.pilot. Nie uruchamiano modeli. Hash builda:
`744d000859f59d5d07c6af4986c3a640c4d8f78e566f618cc7885eda725d8da3` (bez zmiany bridge’a).
Handshake JSON SHA-256:
`16de637746dad05e0f74059b57bffe864b95c390bc1935b9ce6ff15bc05447c2`.
Lokalne dowody: `$RUN/build.log`, `handshake.json`, `manifest.json`, `evidence/prepared`.

Krótka instrukcja wznowienia (zmienne ustaw w każdym terminalu):

```bash
export RUN=/tmp/wave10-pilot-406f0e1
export W10_CLI="$RUN/runtime/tools/pilot/wave10/pilot.py"
python3 "$W10_CLI" preflight --run "$RUN"   # bez modeli
# DOPIERO PO zgodzie użytkownika: approval.example.json -> approval.json;
# approved=true, subscription_only_confirmed=true, dokładny budżet v2 i SHA.

# Terminal A, potem wklej START-A.txt:
python3 "$W10_CLI" launch --run "$RUN" --pair a --mode start
# Terminal B, potem wklej START-B.txt:
python3 "$W10_CLI" launch --run "$RUN" --pair b --mode start
# Obie pary kończą r1/review/waiting_user; wykonaj foreign probe wg OPERATOR.md.
# Zapisz native_thread_id A z manager_status w session-a.txt.
# W TUI B wklej ROUND2-B.txt, czekaj na b/.pilot/gate-ready (do 120s od startu B/r2).
# Zamknij A; terminal A:
python3 "$W10_CLI" launch --run "$RUN" --pair a --mode resume
# Potwierdź thread i waiting_user/q1; gdy potrzeba, explicit resume_instance.
# W TUI A wklej ROUND2-A.txt. Terminal O, przed upływem 480s od gate-ready B:
test -f "$RUN/a/.pilot/round2-started"
touch "$RUN/b/.pilot/continue"
python3 "$W10_CLI" snapshot --run "$RUN" --label r2-overlap
# Nie czekaj na zakończenie A/r2 przed release B. Zakończ ocenę/dowody do 60 min.
```

Ostatni commit dokumentacyjny zapisuje wyniki i ten punkt wznowienia bez zmiany pinu.
Pilot modeli nadal NOT RUN. Następny krok po tej korekcie: zatwierdzenie powyższego
zakresu/budżetu i uruchomienie według instrukcji, bez kolejnego pełnego review integracji.

## Autonomiczny pilot v2 — rzeczywisty wynik i STOP

Użytkownik zatwierdził samodzielne sterowanie TUI, modele i budżet v2 oraz rozliczanie
na istniejących kontach. Nie ponawiano kontroli paneli opłat ani nie zmieniano ustawień
rozliczeń. Odpowiedzi produktowe oznaczono jako syntetyczne; q1 pozostało bez odpowiedzi.

### Commity, runtime i przygotowanie

- `19ad974a9e8f0a996425407a5178f536fb97f50c`: operatorowy relay PTY, lokalne ekrany,
  dziennik, powiadomienia końca tur, skończone limity, natywne klienty i dokładny resume.
- `9e8f060c606f88ebf55f8a4cb1e63740691221fd`: rozpoznawanie faktycznego markera
  `Pasted Content`; licznik tur zwiększany dopiero po wysłaniu, nie po wklejeniu.
- Dokumentacyjny commit końcowy zawiera ten wynik i punkt wznowienia; nie zmienia builda.
  Mapowanie historii integracji powyżej pozostaje bez zmian; nie importowano nowych przodków.

Osobny runtime realnego przebiegu: `/tmp/wave10-pilot-9e8f060-auto/runtime`, detached
`9e8f060`. Hash builda `744d000859f59d5d07c6af4986c3a640c4d8f78e566f618cc7885eda725d8da3`
pozostał zgodny z manifestem. npm ci --ignore-scripts/build PASS, 2/2 handshake MCP,
preflight PASS; 14/14 zmienionych testów operatora PASS. Bez przebudowy podczas pracy.
Nie powtarzano pełnego review ani całego zestawu zaakceptowanej integracji.

Wcześniejszy katalog `/tmp/wave10-pilot-19ad974-auto` zachowano po zatrzymaniu samego
przygotowania: prompty zostały w edytorach, bez wysłania, rolloutów i baz bridge’a.
Błąd harnessu poprawiono przed realnym przebiegiem, z nowym commitem/katalogiem/buildem.
Bezmodelowa próba rzeczywistego TUI potwierdziła `/mcp` (bridge connected, 35 tools)
i `/quit` z exit 0. Atrapy testowały transport/limity, nie zastępowały modeli.

### Przebieg i zakres dowodów

Realne Astry to Codex 0.154.0, gpt-6-astra/high, `source=cli`, `originator=codex-tui`.
Bridge utrwalił `native_corroboration=turn-metadata`, właściwy host oraz odrębne bindingi.
Relay usuwał odziedziczony identyfikator rodzica; nie wytwarzał tożsamości ani metadanych
MCP i nie podejmował decyzji review. Każda Astra wykonała jedną turę operatorową.

Każdy Claude (CLI 2.1.269, żądanie opus/high, runtime raportował claude-opus-5)
wykonał jedną rundę R1, z `spec.max_turns=12`, deadline 480000 ms i jedną próbą.
Czasy runtime: A 94.699 s, B 73.089 s; trwałe przedziały prób przecinają się przez
74.394 s. Odrębne execution handles i bazy są w prywatnych snapshotach.

R1 zakończyło się COMPLETE w obu parach. Astry samodzielnie sprawdziły diff, zakres,
wykonały testy i verify paczek, zapisały review inline w bridge i przeszły do
waiting_user/q1. Ich zakończone tury potwierdzają dwa notify i właściwe rollouty.
Nie użyto mechanicznego review zamiast Astr.

| Dostawa syntetyczna | Commit | Niezależna kontrola operatora |
| --- | --- | --- |
| A/r1 | `db72419e7676d07dbd8df40a92d4bd238ec627a0` | verify z oczekiwanym feature/purpose/base/head PASS; 5 testów PASS |
| B/r1 | `5d06b1244e1eaf7dbc573aac978209be730b5b2f` | verify z oczekiwanym feature/purpose/base/head PASS; 3 testy PASS |

Dostawy i ich commity są w izolowanych worktree; nie importowano ich do brancha wave10.

### Przyczyna zatrzymania — błąd operatora, nie wykazana wada integracji

Obie Astry zgłosiły rozbieżność: telemetryczne `turn_count=18` przy zadanym
`max_turns=12`. Koordynator potraktował to jako warunek STOP, zachował snapshot i
normalnie zamknął obie Astry przez `/quit` przed foreign probe i R2. To było przedwczesne:
semantykę licznika należało ustalić przed przerwaniem prawidłowej sekwencji.

Kod przypiętego runnera przekazuje `spec.max_turns` do `--max-turns`, a `turn_count`
kopiuje z `ResultMessage.num_turns`. Nie wykazano utraty argumentu ani zmiany limitu.
Surowe zapisy każdej sesji: **12 różnych message.id odpowiedzi modelu, 11 obiegów
z tool_use, 17 tool_result i num_turns=18**. Bloki tekstu/thinking/tool_use o tym samym
message.id nie są kolejnymi obiegami. Wyniki runtime to completed/exit 0, nie max_turns.

Dokumentacja Claude definiuje limit jako obiegi z użyciem narzędzi, a strumień może
zawierać wiele bloków jednej odpowiedzi. Zapis wspiera zgodność wykonanych R1 z limitem;
nie wspiera tezy, że porównanie 18 > 12 dowodzi jego naruszenia.
Źródło: [Claude Code — turns and messages](https://code.claude.com/docs/en/agent-sdk/agent-loop#turns-and-messages).
Zbieżny raport o porównywaniu różnych liczników znajduje się w
[zgłoszeniu Claude Code Action #1795](https://github.com/anthropics/claude-code-action/issues/1795);
nie zastępuje on lokalnych dowodów ani nie dowodzi konkretnej wady bridge’a.

Po zamknięciu obu klientów nie wykonano zastępczych sesji, retry ani dodatkowego
recovery. Dodatkowe wznowienie B zmieniałoby zatwierdzoną sekwencję, w której B ma
pozostać aktywne podczas restartu A. Ten przebieg kończy się częściowym wynikiem.

### P1–P7 i wykorzystany budżet

| Kryterium | Wynik | Dowód / brak |
| --- | --- | --- |
| P1 | PASS | Osobny pin/build, dwa handshake bez stanu i preflight. |
| P2 | PASS | Dwie prawdziwe Astry TUI, dwa różne Claude’y, 74.394 s overlap prób R1. |
| P3 | UNVERIFIED | R1: osobne bazy, bindingi, worktree, namespace, paczki i treść A/B. Pełne dwurundowe kryterium nieprzetestowane. |
| P4 | UNVERIFIED | Waiting_user/q1 obu potwierdzone; brak restartu A podczas B/r2. |
| P5 | UNVERIFIED | Tylko jedna runda w każdej sesji; brak kontynuacji R2. |
| P6 | UNVERIFIED | Obcego managera nie uruchomiono; brak porównania przed/po próbą. |
| P7 | UNVERIFIED | Dwie paczki verify PASS i 8 testów PASS; dwóch paczek R2 brak. |

Wykorzystano 2/4 rund Claude’a, po 11 obiegów tool-use i 12 odrębnych odpowiedzi;
po 1/10 tur operatorowych każdej Astry, 0/2 tur foreign. Czas od startu klientów do
zatrzymania operatora: 381.31 s (<60 min). Zero retry, recovery, dodatkowych rund lub
zastępczych sesji. Koszt raportowany przez runtime Claude’a jest ekwiwalentem użycia,
nie dowodem faktury API; tryb rozliczeń potwierdził użytkownik. Nie przypisujemy kwoty
0 faktycznemu zużyciu subskrypcji ani nie zmieniamy jej ustawień.

### Dowody lokalne i punkt wznowienia

Katalog: `/tmp/wave10-pilot-9e8f060-auto`. Surowe logi PTY, notify, działania operatora,
UUID, rollouty Astr, transkrypty Claude’a i bazy pozostają poza Git. Snapshoty:
`evidence/r1-workers-active`, `evidence/stop-turn-budget`, `evidence/final-stopped`.
`operator/assessment` zawiera verify/test logs, kopie właściwych sesji, dane licznika
oraz assessment.json. `evidence-index.json` wiąże je hashami; SHA-256 indeksu:
`19d88d9630ed37b0e2e848d4c907b567c4242aedcbdf11e5294a3745a83d9fc1`.
Żaden proces tego runtime/launchera/operatora nie pozostał aktywny.

**Punkt wznowienia:** nie uruchamiać automatycznie ROUND2 ani ponownie używać katalogu.
Instrukcja OPERATOR.md zawiera korektę semantyki tur. Otwarte ustalenie W10-10 opisuje
przedwczesny STOP operatora; następne wykonanie musi najpierw mieć rozstrzygniętą
sekwencję po nieplanowanym zamknięciu B. Nie deklarujemy gotowości całego scenariusza
na podstawie częściowego wyniku. Oryginalny scenariusz i budżet pozostają w OPERATOR.md;
nie wydano jego pozostałej części i nie poproszono ponownie o potwierdzenie kont/opłat.
Integracja pozostaje lokalnie gotowa do review; **realny pilot niezaliczony, wave10 otwarte**.
Bez push, merge, zmian aktywnych runtime i worktree innych fal.

Końcowy check dokumentacji/test discovery: 14 testów operatora i 5 testów przenośności
PASS; git diff --check PASS. Opcjonalny moduł PTY jawnie SKIP przy braku pexpect/pyte
(test izolacji `python3 -S`), a przy dostępnych bibliotekach jego 5 testów PASS.
Ta korekta test discovery nie zmienia narzędzi przygotowania ani runtime 9e8f060.

## Kontynuacja istniejących sesji — przygotowanie bez modeli

Aktualne zlecenie obejmuje sprawdzenie i przygotowanie, nie wykonanie dalszych modeli.
Własny worktree/branch wave10, wejście `1c6e635`. Poprawka:
`c136c7d73d22cf898c5156034b4b8873bec280ed`, następnie
`51c358a02304b7fcbbfbe93978878bd4923fec2f` (jednolita wielowierszowa ścieżka wklejania
wszystkich promptów, w tym foreign). Oryginalne branche i mapa historii
pozostają bez zmian. Końcowy commit tego punktu wznowienia jest dokumentacyjny.

**Możliwość dokończenia:** dane do dokładnego resume obu Astr i kontynuacji obu
Claude’ów zachowały się. Nie ma potrzeby ponawiania R1. Nie jest to jeszcze dowód
udanego natywnego resume — ten musi powstać po zatwierdzeniu nowych wywołań.

Odczytowy audit sprawdził obie bazy: quick_check OK, waiting_user, pytanie q1 bez
odpowiedzi, po jednej COMPLETE próbie R1, epoch 1/generation 2, aktywna instancja null,
zakończenie starej instancji detached. UUID session-a/b zgadzają się z bindingami;
po jednym dokładnym rolloucie source=cli/originator=codex-tui i po jednym transkrypcie
pod zachowanym execution_handle Claude’a. Worktree/namespace/database_path zgadzają się
z zapisanym workspace bindingiem. Oba HEAD czyste, obie paczki R1 nadal verify PASS.
Manifest wiąże stan, HEAD, hashe paczek i plików sesji. Audit przed/po przygotowaniu
oraz ponowny preflight dały identyczny wynik. Bazy nie były kopiowane ani mutowane.

### Znaczenie liczb — ustalone z implementacji i dowodów

Badano dokładnie CLI 2.1.269 użyte w R1, binarny SHA-256
`25e44883f54419569a3d739f38cbbdaebe83b09895da0f343e1b003710a4775b`.
Osadzona implementacja zwykłego, niedeferowanego success inicjuje licznik raportu
wartością 1 i zwiększa go dla każdego komunikatu user silnika. W obu zachowanych
transkryptach: początkowy prompt oraz 17 komunikatów tool_result, więc wynik 18 ma
konkretne wyjaśnienie. To nie liczba różnych wywołań modelu.

12 różnych message.id to odrębne odpowiedzi modelu po złożeniu ich bloków;
11 z nich zawiera tool_use. Te dwa odtworzone pomiary nie zastępują pola num_turns
ani nie stają się nowym egzekutorem budżetu. Implementacja silnika ma oddzielny
licznik iteracji i porównanie następnej iteracji z opcją maxTurns. Po przekroczeniu
emituje max_turns_reached, a warstwa wyniku error_max_turns używa licznika przekroczenia.
Zatem nawet semantyka num_turns zależy od gałęzi wyniku; nie stosujemy wzoru 1+17
jako uniwersalnej definicji wszystkich wyników/wersji/resume.

Runner bridge’a nadal przekazuje zwalidowane spec.max_turns=12 jako `--max-turns 12`,
chroni tę flagę przed override, zapisuje surowe frame.num_turns i mapuje rzeczywiste
zakończenie limitu na FAILED. Kod produkcyjny niezmieniony. Bezmodelowe buildArgs
potwierdziło jednocześnie wartość 12 i exact --resume dla syntetycznego handle.
Pięć istniejących regresji runnera (flag protection, finite default, invalid budget,
raw telemetry, max-turns failure) PASS; użyto atrap w nowym pomocniczym buildzie.
To nie test granicy realnego modelu ani dodatkowe wywołanie Claude’a.

Błędny warunek STOP był decyzją koordynatora w poprzednim przebiegu; nie istniał jako
if w starym relay. Wycofano go z protokołu decyzji, a nowy operator i prompty wyraźnie
zakazują porównania success num_turns z limitem. Dodano regresję success 18/spec12
bez STOP oraz rzeczywistego FAILED ze STOP. Telemetrii historycznej nie poprawiano.
Szczegółowa semantyka, kodowe miejsca odpowiedzialności i źródło dokumentacji są w
[CONTINUATION.md](../../tools/pilot/wave10/CONTINUATION.md); lokalne minimalne wycinki
implementacji z offsetami/hashami pozostają poza Git.

### Konkretny zestaw przygotowania

- Końcowy pin narzędzi: `51c358a`, katalog `/tmp/wave10-continuation-51c358a/runtime`.
  Osobny npm ci/build PASS, 2/2 handshake MCP i preflight PASS. Pomocnicze `a`/`b`
  tego katalogu służyły tylko handshake, nie będą parami modelowymi.
- **Bridge używany przy kontynuacji pozostaje oryginalny `9e8f060`**, w
  `/tmp/wave10-pilot-9e8f060-auto/runtime`, z niezmienionym hashem builda 744d0008…725d8da3.
- Nowy manifest i prompty: `/tmp/wave10-continuation-51c358a/continuation`.
  Manifest SHA-256: `dbaa515e61f4c1dde90fb677a2d3b8e60bb8db72407771c53d2d45b7347771ec`.
  `launch-commands.json` przechowuje prywatne, dokładne komendy resume dla obu starych
  UUID oraz ponownego restartu A. Foreign jest jedyną nową sesją managera.
- `approval.example.json` ma approved=false; właściwy approval.json nie istnieje.
  Nie powstał nowy operator/started-at. Stare approval, zegar i dowody są zachowane.
- 24 testy operatora PASS (w tym 10 nowych); 5 wybranych regresji runnera PASS.
  Nie powtarzano pełnego review integracji. Nie uruchomiono modeli ani mutujących MCP.

### Najmniejszy brakujący przebieg i budżet do zatwierdzenia

1. BOOT obu zachowanych Astr: exact native resume, explicit manager_resume_instance
   z odczytanym epoch/generation, potwierdzenie waiting_user/q1 i starego R1. Bez
   answer_user, ponowienia review R1, nowego roota/feature ani delegacji.
2. Foreign probe przy nieaktywnych workerach, wynik narzędzia MANAGER_FOREIGN_THREAD
   oraz identyczne pełne logiczne snapshoty A/B, ownerów, markerów i paczek przed/po.
3. B/r2 z zachowanym Claude’em i bramką. Dopiero po active attempt + gate-ready
   zamknięcie A i dokładne ponowne resume A w czasie aktywnego B.
4. Potwierdzenie tej samej tożsamości, waiting_user/q1; A/r2. Release B po markerze
   prawdziwego startu A i dowodzie aktywności B, bez oczekiwania na wynik A.
5. Koniec obu rund, autentyczne review Astr, verify wszystkich 4 paczek względem
   właściwych base/head, testy obu końcowych drzew, porównanie obu handles i finalny raport.

Budżet **tylko nowych wywołań**: 2 rundy Claude max_turns=12 każda; A/r2 8 min,
B/r2 20 min. 3 tury Astry A (BOOT/restart/R2+review), 2 B (BOOT/R2+review), 1 foreign.
Nowe okno 45 min od startu operatora, B/r2 start najpóźniej w 20. minucie; gate-ready
w 120 s, operator 480 s, gate 540 s, Bash 600 s, MCP 1320 s. Przy najpóźniejszym
starcie B zostaje co najmniej 5 min na finalne dowody. Bez tur zapasowych, retry,
dodatkowego task recovery ani dodatkowych wywołań API; potwierdzenie kont/subskrypcji
pozostaje ważne i nie wymaga ponownej kontroli paneli. Po błędzie STOP bez resetu zegara.

### Granice oceny łącznej

P1 i P2 mają już dowody z pierwszego segmentu. P3 (izolacja przez obie rundy) i P5
(te same sesje Claude’a) można ocenić z połączonych dowodów R1/R2, pod warunkiem pełnej
zgodności zachowanych tożsamości, baz, namespace i provenance. P4 musi zostać wykonane
w całości na nowo w kontynuacji: poprzednie zamknięcie obu klientów nie odbyło się
podczas aktywnego B/r2. P6 wymaga całkowicie nowego realnego foreign probe i porównania
stanu; regresja z atrapą nie zastępuje tego dowodu.

P7 rozbijamy opisowo na poddowody, **nie zmieniamy jego definicji**. Cztery verify,
końcowe testy i ograniczenia rund można rozliczyć łącznie. Oryginalnego warunku jednej
nieprzerwanej godziny v2 nie da się uzyskać przez sumowanie aktywnego czasu dwóch
segmentów. P7 oryginalnego v2 oraz status pełnego nieprzerwanego v2 nie będą oznaczone
PASS. Jedynie nowy pełny przebieg mógłby udowodnić pierwotny harmonogram end-to-end;
powtarzanie R1 nie jest częścią tej propozycji ani obecnego zlecenia.

### Punkt wznowienia

Najpierw zatwierdzenie powyższego nowego scope/budżetu; nie ponawiamy zgody dotyczącej
opłat. Po zgodzie koordynator powtarza read-only preflight z przypiętego narzędzia:

```bash
python3 /tmp/wave10-continuation-51c358a/runtime/tools/pilot/wave10/continuation.py preflight \
  --out /tmp/wave10-continuation-51c358a/continuation
```

Następnie zapisuje lokalny approval dla dokładnego hash manifestu i uruchamia `serve`
z tym samym --out. Pełne kroki automatycznego operatora, nazwy promptów i warunki
przejścia są w CONTINUATION.md. Nie używać starego launchera v2, --last ani kopiowanych
baz; nie uruchamiać nowych helperowych a/b. Drift od przygotowania wymaga STOP,
nie aktualizacji manifestu „w locie”. Bieżący etap jest ukończonym przygotowaniem
kontynuacji do zatwierdzenia, nie zaliczonym resume ani końcem wave10.

Końcowy pin 51c358a: build oraz 2/2 handshake PASS, odczytowy preflight PASS.
Zachowany baseline jest identyczny także z wcześniejszym przygotowaniem c136c7d.
Poprzedni pomocniczy katalog zachowano, ale nie jest punktem startu. 5 testów
przenośności i git diff --check PASS. W tym etapie zero modeli i zero mutujących MCP.

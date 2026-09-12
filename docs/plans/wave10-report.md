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


## Zatwierdzona kontynuacja v2 — BLOCKED na operatorze TUI

Ten zapis zastępuje wcześniejszy status oczekiwania na zgodę; historyczne wyniki
pozostają bez zmian. Zgoda użytkownika: dwie pozostałe rundy45min/max_turns32,
MCP55min, operator20min, B gate25min/Bash30min, segment90min; tury Astr planem.
Rozliczanie potwierdzone; bez dodatkowych rund/retry/recovery.

Przygotowanie: 34bd367 uzgodnił timeouty, 79f75e0 poprawił spłaszczone TOML
overrides lokalnego MCP env. Świeży pomocniczy build79f75e0, handshake2/2,
preflight i26 testów operatora PASS. Produkcyjny bridge9e8f060 niezmieniony.
Rzeczywiste procesy MCP potwierdziły Bash max1800000 i background disabled.
Nie zmieniono globalnych limitów ani nie powtarzano review integracji.

Obie prawdziwe Astry TUI wznowiły dokładnie zachowane sesje; po jednej turze
BOOT potwierdziły manager resume epoch1/generation2→3, waiting_user/q1
unanswered i historyczny R1. Dowody: rzeczywiste wywołania MCP, bazy, notify.

Foreign klient wystartował w A, zgodnie z negatywnym testem obcej tożsamości
w tym samym worktree. Automatyczna kontrola początkowo odmówiła z powodu
tego katalogu; po odczycie promptu i guardu dopuściła akcję. Nie obchodzono
zabezpieczeń. Następnie krótki wielowierszowy prompt wyświetlił się literalnie,
bez `[Pasted Content]`, na który czeka Client. Enter nie został wysłany.
Requested foreign=1 nie oznacza tury: rzeczywiste turns_sent=0, brak notify.
Nie ma wykonanego probe ani podstawy do zaliczenia odmowy bez mutacji.

STOP zgodnie z instrukcją przy błędzie: A/B normalnie /quit; foreign z niewysłanym
tekstem zakończony przez relay. Finalnie quick_check obu baz OK, epoch1/generation4,
brak aktywnych instancji, waiting_user/q1 unanswered, po1 historycznej Claude
COMPLETE. R1 paczki identyczne, brak własnych procesów MCP. Zużycie segmentu:
**Astra A1/B1, Claude0/2, foreign0/1 faktycznych tur**. Około9min do auditu;
zero retry/recovery, zero R2 i nowych paczek. Nie zaliczamy całego wave10.

| Kryterium | Wynik |
| --- | --- |
| P1 | PASS z historycznego R1; nie powtarzano. |
| P2 | PASS z historycznego R1; nie powtarzano. |
| P3 | UNVERIFIED całości: izolowane bazy/R1 zachowane, brak R2. |
| P4 | UNVERIFIED: exact resume działa, lecz nie podczas aktywnego B/r2. |
| P5 | UNVERIFIED: handles zachowane, brak drugiego wykonania Claude. |
| P6 | UNVERIFIED: prompt foreign nie opuścił edytora. |
| P7 | UNVERIFIED: brak verify4/finalnych testów i nieprzerwanego v2. |

### Punkt wznowienia po STOP

Dowody poza Git: /tmp/wave10-continuation-79f75e0/continuation/operator/ oraz
evidence/foreign-paste-block i evidence/final-audit.json. W starym katalogu
pilota snapshoty cont2-before-foreign i cont2-stopped. Identyfikatory i logi
pozostają prywatne. Stare runtime, wyniki, approval i zegary zachowane.

Nie uruchamiać ponownie starego serve ani nie zmieniać manifestu w miejscu:
resume/close prawidłowo zmieniło generation2→4. W10-09 ponownie otwarte
w jednej liście ustaleń. To kolejny nawrót renderowania wklejki; prostsze
podejście: oddzielić paste od jawnego submit operatora po sprawdzeniu ekranu,
z jednokrotnym Enter i licznikiem faktycznych tur. Nie zastępuje decyzji Astr.
Najpierw sprawdzić bez modeli krótkie/długie wejście w prawdziwym TUI, potem
nowy pin operatora, świeży katalog i odczytowy baseline zachowanych sesji.
Nie wdrożono zmiany w działającym zestawie ani nie wykonano ponownej próby.

Brakujące: foreign probe, B/r2, zamknięcie/resume A podczas aktywnego B,
A/r2, natychmiastowe release po starcie A, rzeczywiste review, verify4/testy.
R1 nie powtarzać. Zgoda zakresu i billing pozostaje udokumentowana; zatrzymany
segment nie jest aktywnym oknem ani nieprzerwanym pilotem. Bez push i merge.


## Segment po naprawie relay4f32170 — wynik i punkt wznowienia

User zatwierdził restart klientów, niewysłaną próbę foreign i nowe90minokno przy
zachowanych większych limitach. Zgoda zapisana przy nowym manifeście. To osobny
segment; wcześniejsze wyniki i ich zużycie pozostają niezmienione.

Commit4f32170 usuwa zależność wysłania od etykiety wklejki. `prompt` tylko wkleja;
`submit` wysyła Enter raz po inspekcji ekranu, z kontrolą jego SHA. `confirm` czyta
nową część natywnego rolloutu: wymaga task_started i dokładnego tekstu użytkownika.
Brak potwierdzenia blokuje dalszą wysyłkę; odczyt confirm nie ponawia modelu.
30 testów ukierunkowanych PASS: krótkie/multiline, opóźniony prawdziwy PTY bez modeli,
brak potwierdzenia, brak podwójnego Enter, niedopuszczenie historycznego dopasowania.
Wszystkie140 testów narzędzi pilota PASS. Świeży pomocniczy build4f32170,
2/2 MCP handshake i retained-state preflight PASS. Produkcyjny bridge9e8f060
niezmieniony; nie zmieniono innych runtime/worktree ani globalnych limitów.

### Rzeczywisty wynik

Dokładne natywne sesje A/B wznowione; po1 BOOT, generation4→5, waiting_user/q1
unanswered i historyczny R1 potwierdzone. Długie BOOT oraz krótki FOREIGN zostały
jawnie zatwierdzone i potwierdzone w natywnych rolloutach. W10-09 zamknięte tymi
dowodami; to nie wynik samej atrapy. Nie było niepewnego ponowienia promptu.

Jedyna foreign tura wykonała dokładnie1 manager_status i1 create_task. Agent dobrał
puste scope.paths do niedookreślonego „minimal no-write spec”. Schema wymaga co
najmniej1 elementu, więc MCP zwrócił **-32602** przed kontrolą managera. Agent
zakończył turę bez retry. To nowa uwaga W10-11, nie ponowny błąd sterowania TUI.

Przed/po probe identyczne: bazy SQLite, logical.sql, owner, workspace.json, git.json
i pakiety obu par. Brak mutacji udowodniony, ale nie pochodzi z guardu foreign:
**P6 pozostaje UNVERIFIED**. Nie traktujemy odmowy schematu jako MANAGER_FOREIGN_THREAD.
Zgodnie z warunkiem STOP przy błędzie i limitem1 próby zakończono przed B/r2;
nie wykonano retry, task recovery ani dodatkowych rund.

Wszystkie trzy klienty normalnie /quit. Finalnie epoch1/generation6, brak aktywnych
instancji, quick_check obu baz OK, waiting_user/q1 unanswered, po1 historycznej
Claude COMPLETE, R1 i jego paczki zachowane. Brak własnych procesów MCP.

| Segment | Nowe tury A/B | Foreign | Nowe wykonania Claude | Czas |
| --- | --- | --- | --- | --- |
| Pierwotny realny R1 | Według historycznego raportu | Według historycznego raportu | 2 historyczne R1 | Historyczny zegar bez zmian |
| Kontynuacja79f75e0 | 1/1 | 0 przyjętych tur | 0 | Około9min do auditu; osobny zapis |
| Kontynuacja4f32170 | 1/1 | 1 przyjęta tura,1 próba create | 0 | 255.103s od nowego startu do STOP |

Pozostały niewykorzystane **2 wykonaniaClaude po45min/max32**; autoryzowana pojedyncza
próba foreign w tym segmencie została wykorzystana. Nie odnawiamy jej automatycznie.
P1/P2 zachowują historyczne PASS. P3/P4/P5/P6/P7 całości nadal UNVERIFIED: brak R2,
restartu A podczas aktywnego B, ciągłości Claude R1/R2 i verify4. Zwykłe exact resume
A/B udowodnione; nie zastępuje P4. Nieprzerwany pierwotny v2 pozostaje nieudowodniony.

### Lokalny checkpoint

Zestaw /tmp/wave10-continuation-4f32170/continuation zawiera approval, manifest,
operator/actions.jsonl, status, native notify, ekrany i PTY; evidence zawiera
foreign-comparison.json i final-audit.json. Oryginalne evidence zawiera snapshoty
cont3-before-foreign/cont3-after-foreign. Surowe identyfikatory, bazy i logi poza Git.

Nie restartować zakończonego relay ani nadpisywać manifestu z generation4.
W10-11 wymaga konkretnego poprawnego schematycznie specu w przygotowanym prompcie,
sprawdzonego bez modeli; pusta lista paths nie jest dozwolonym „no-write”.
Wywołanie create_task nie uruchamia workera, ale musi przejść walidację, żeby móc
sprawdzić właściwy guard. Kolejny realny probe wymaga zgody na dodatkową próbę,
której aktualny limit nie obejmuje. Nie jest potrzebna ponowna kontrola rozliczania.
Po rozszerzeniu zakresu: świeży operator/baseline zachowanych sesji generation6,
foreign, B/r2, normalny restart A podczas B, A/r2 i immediate release, review i verify4.
R1 nie powtarzać, nie tworzyć zastępczych par. Status: **RELAY POPRAWIONY / PILOT
ZATRZYMANY NA SCHEMACIE PROBE**; bez push, merge ani deklaracji ukończenia wave10.


## Wynik końcowy zatwierdzonego segmentu main-first

**Wykonano oba zatwierdzone scenariusze: R2/restart/review oraz niezależny foreign.**
Stan: GOTOWE DO REVIEW, bez deklarowania ukończenia całego wave10 ani nieprzerwanego
pierwotnego pilota v2. Ta sekcja jest aktualnym wynikiem; wcześniejsze wpisy pozostają
historią przygotowania, przerw i błędów, a nie nadal aktywnymi blokadami.

### Commity, przygotowanie i granice

Przygotowanie `d7cdbb0` opiera się na relay `4f32170`. Zmiany ograniczono do nowego
scope/budżetu kolejności i dokładnych argumentów foreign z walidatorem. Ogólnego relay
nie rozbudowano. Świeży osobny zestaw `/tmp/wave10-main-first/runtime` jest przypięty
do d7cdbb0; build,2/2 handshake bez utworzenia stanu i preflight PASS. Produkcyjny
bridge pozostał9e8f060 z pierwotnym hashem builda; końcowy preflight potwierdził brak
zmiany. Nie przebudowywano działającego runtime ani głównego checkoutu.

Gotowe argumenty foreign przeszły rzeczywisty MCP Zod inputShape z runtime9e8f060.
Walidator nie tworzy serwera ani nie wywołuje handlera; negatywna kontrola paths=[]
poprawnie odrzucona. Prawdziwy foreign dostał gotowy JSON i wykonał go bez zmian.
30 ukierunkowanych oraz140 wszystkich bezmodelowych testów narzędzi PASS.
Nie powtarzano pełnego review integracji. Mapowanie oczyszczonej historii z początku
raportu pozostaje bez zmian; prywatne commity pilota nie zostały importowane jako przodki.

### Główny scenariusz — dowody

1. Oryginalne Astry A/B wznowione przez exact native resume, generation6→7,
   z zachowanym R1 i waiting_user/q1 bez odpowiedzi. Bez zastępczych sesji/par.
2. B zapisała syntetyczne `suffix -B` i uruchomiła jedno B/r2 w oryginalnej sesji
   Claude’a. Worker wykonał nową bramkę; aktywna próba i gate-ready zapisane.
3. Podczas aktywnego B normalnie zamknięto A (generation8, detached), wznowiono
   dokładnie ten sam native thread i jawnie manager instance (generation9).
   Astra odczytała tożsamość oraz waiting_user/q1 unanswered przed swoim R2.
4. A zapisała syntetyczne `suffix -A`, uruchomiła jedno A/r2 w oryginalnym Claude.
   Operator zaobserwował aktywne próby obu par i marker A, po czym zwolnił B.
   Opóźnienie marker A→release: **0.139s**. Bramka B: **267.682s**, bez czekania
   na wynik A. Rzeczywisty overlap prób R2: **77.708s**.
5. A/r2 COMPLETE po81.283s, B/r2 COMPLETE po346.589s łącznie z bramką. Obie Astry
   samodzielnie przeczytały dostawy, uruchomiły testy/verify i zapisały review PASS
   w bridge (inline/status/artifact), bez mechanicznego zastępowania review przez
   operatora. Przekazanie wyników potwierdzone przez natywne notify.

Obie Astry początkowo przekazały zbyt długi objective. Otrzymały INVALID_ARGUMENT
przed utworzeniem task/attempt, odczytały stan i skróciły kontrakt z kluczemr2.
To W10-12: jawny błąd przygotowania i korekta przed wykonaniem, nie retry workera.
W bazach są dokładnie dwa COMPLETE na parę: historyczne R1 i jedno nowe R2.
Brak FAILED, recovery, dodatkowych rund lub niepewnego ponawiania wykonania.

| Para / runda | Base | Head | Verify |
| --- | --- | --- | --- |
| A/r1 | f7921baf5305121b2cb985984e0b5446b35815b2 | db72419e7676d07dbd8df40a92d4bd238ec627a0 | PASS, oryginalny ZIP bez zmian |
| A/r2 | db72419e7676d07dbd8df40a92d4bd238ec627a0 | 7cc6628928318c4677752c83eeeb64cffef80e68 | PASS |
| B/r1 | 412fe2c609e3392a78b1d7eab96959a0782b7cd5 | 5d06b1244e1eaf7dbc573aac978209be730b5b2f | PASS, oryginalny ZIP bez zmian |
| B/r2 | 5d06b1244e1eaf7dbc573aac978209be730b5b2f | e50dc4d8ebd777ba4b0b88b38faf0dee180b4a66 | PASS |

Końcowe testy: A6/6, B3/3 PASS. Zakres commitów R2 wyłącznie render.py,
test_render.py i nowy ledger execution/r2/01.md; oba worktree czyste, markery ignorowane.
R1 ZIP-y i wcześniejsze prefiksy natywnych/Claude logów zachowane. Ta sama nazwa feature,
rund i paczek w obu parach, ale oddzielne namespace, bazy, worktree i treść A/B.

### Niezależny foreign — dowody

Po zakończeniu obu workerów i review uruchomiono prawdziwego obcego Codexa w A.
Jego natywne metadata source=cli/originator=codex-tui i thread różny od obu managerów.
Wykonał dokładnie1 manager_status oraz1 create_task z niepustym paths i **dokładnie
przygotowanym JSON**. Wynik rzeczywistego narzędzia: **MANAGER_FOREIGN_THREAD**,
retryable=false. Bez takeover, zmiany sesji, delegacji czy obchodzenia walidacji.

Pierwsza próba wystarczyła; druga z dozwolonych2 nie została wykorzystana.
Przed/po identyczne w obu parach: bazy SQLite, logical.sql, database.owner,
workspace.json, Git, paczki oraz markery A round2-started/B gate-ready/continue.
To dowód guardu i braku mutacji, odrębny od historycznej odmowy-32602.

### Kryteria — osobne wyniki i granice

| Kryterium | Wynik | Podstawa |
| --- | --- | --- |
| P1 | PASS | Osobny przypięty build, dwa handshake i preflight; runtime bez zmian. |
| P2 | PASS | Dwie prawdziwe Astry TUI i różni Claude; overlap R1 74.394s, R2 77.708s. |
| P3 | PASS, dowody R1+R2 | Te same nazwy przy odrębnych bazach/worktree/namespace/ZIP/treści; brak mieszania. |
| P4 | PASS, nowy segment | Waiting_user A, normalne close, exact resume i q1 podczas aktywnego B/r2. |
| P5 | PASS, dowody R1+R2 | Każda para zachowuje własny Claude handle; dokładnie R1+R2, bez zastępczych prób. |
| P6 | PASS, niezależny scenariusz | Prawdziwy foreign, dokładny JSON, MANAGER_FOREIGN_THREAD i identyczny pełny stan przed/po. |
| P7 | PASS dla zatwierdzonego segmentu; pierwotny v2 UNVERIFIED | Cztery verify i końcowe testy PASS, aktualny zakres/budżet zachowane. Nie dowodzi pierwotnego nieprzerwanego okna60min. |

Nie zmieniamy kryteriów historycznego pilota: jego przerwy nadal istnieją.
Jedynie nowy pełny przebieg mógłby dowieść pierwotnej nieprzerwanej sekwencji v2;
taki przebieg nie był zlecony i nie powtarzano w tym celu R1. Aktualny odbiór dotyczy
wyraźnie zatwierdzonych scenariuszy na zachowanym stanie, nie retroaktywnego PASS v2.

### Budżety, rzeczywiste zużycie i historia przerw

Aktualne limity:2 Claude po45min/max_turns32, MCP55min, operator20min,
gate25min/Bash30min, segment90min; potrzebne tury Astr autoryzowane. W procesach
MCP potwierdzono lokalny Bash max1800000 i wyłączenie background; runtime deadline
pochodzi z wywołań2700000ms. Globalnych defaultów nie zmieniono.

| Segment | Tury operatorowe A/B/foreign | Claude | Czas / przyczyna końca |
| --- | --- | --- | --- |
| Wczesny19ad974 | Brak wysłanych promptów | 0 | Błędny marker wklejki, zachowany wynik historyczny |
| Pierwotny9e8f060 R1 | 1/1/0 | 2 R1 | 381.310s; błędna interpretacja num_turns18 jako naruszenia max12 |
| Kontynuacja79f75e0 | 1/1/0 | 0 | 469.078s do STOP; krótki prompt foreign niewysłany. Wcześniejsze około9min obejmowało końcowy audit |
| Kontynuacja4f32170 | 1/1/1 | 0 | 255.103s; schema-32602 przed guardem, bez retry |
| Main-first d7cdbb0 | 3/2/1 | 2 R2 | **868.526s (14min29s)**; zakończono oba scenariusze, wszyscy klienci normalnie zamknięci |

W nowym segmencie wykorzystano2/2 wykonańClaude oraz1/2 próbforeign. To liczby tur
operatorowych klientów, nie utożsamienie z liczbą wewnętrznych wywołań modelu.
Telemetria R2: turn_count A10/B13, limit wykonawcy32; pola pozostają rozdzielone.
Reported_cost_usd A0.800363/B0.8176555 to runtime-reported ekwiwalent, nie faktura
ani dowód dodatkowej opłaty API. Rozliczanie na kontach użytkownika potwierdzone;
nie zmieniano ustawień, nie sprawdzano ponownie paneli. Koszt Astr pozostaje unknown,
nie zero. Raw telemetry zachowane prywatnie. Historycznych zegarów nie resetowano.

### Końcowy punkt wznowienia / odbioru

Wszystkie klienty zamknięte normalnie. Brak aktywnych workerów/MCP. Bazy quick_check OK;
A epoch1/generation10, B epoch1/generation8, detached. Feature obu par awaiting_review
po review PASS, **nie zaakceptowany**; odpowiedzi q1 syntetyczne. Korzenie managerów
pozostają WORKING zgodnie z zakresem. Nie uruchamiać ponownie serve/R2, nie robić
recovery DONE tasków ani kopiować baz. Następny krok: review raportu i decyzja odbioru.

Dowody lokalne: `/tmp/wave10-main-first/continuation/` — manifest/approval, operator
PTY/screens/actions/notify; evidence/final-audit.json, final-checks.json,
timing-summary.json, telemetry.json, mcp-timeout-env.json, release-observation.json,
foreign-comparison.json. W oryginalnym katalogu evidence: main-b-active-a-waiting,
main-a-resumed-b-active, main-r2-overlap, main-complete-before-foreign,
main-after-foreign. Native UUID, Claude handles, surowe logi i bazy poza Git.

Lokalne commity obejmują wyłącznie przygotowanie i dokumentację. Bez push, merge,
podmiany aktywnego runtime ani zmian innych fal. **GOTOWE DO REVIEW — zatwierdzona
kontynuacja wykonana; cały wave10 nadal otwarty.**


Zabezpieczenie dowodów po zamknięciu: snapshot main-final-closed oraz prywatne kopie
obu rolloutów Astr, obu transkryptów Claude i foreign w evidence/session-copies.
Indeks65 plików: /tmp/wave10-main-first/evidence-index.json, SHA-256
259c5606d5b4aecb1a9e4eb4a5308eedbf6b62cd308928bfdb4ff2b2ce6f42bb.
Indeks i kopie pozostają poza Git. Końcowe git diff --check oraz kontrola nowych linii
pod kątem natywnych UUID/prywatnych ścieżek domowych PASS.

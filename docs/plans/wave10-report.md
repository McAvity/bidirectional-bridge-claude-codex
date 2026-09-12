# Wave10 — raport integracji i przygotowania pilota

Status: **GOTOWE DO REVIEW / PILOT PRZYGOTOWANY**. Cały wave10 pozostaje otwarty:
nie wykonano real-model pilota, publikacji ani CI. Modele/delegacja nieuruchomione.
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
| `88bccc71d7e5e72ec1daeaf13922615aa28fab60` | Dokładne argumenty feature_run i eksportera w instrukcji. **Pin runtime pilota.** |

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

## Walidacja i ograniczenia

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

Przygotowanie nowego pinu i dowody zostaną dopisane po build/preflight/handshake.
Pilot modeli nadal NOT RUN. Następny krok po tej korekcie: zatwierdzenie powyższego
zakresu/budżetu i uruchomienie według instrukcji, bez kolejnego pełnego review integracji.

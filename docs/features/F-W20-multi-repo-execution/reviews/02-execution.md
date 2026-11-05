# F-W20 — rejestr review wykonania i ustaleń

## 2026-11-05 — kontrakt W20-01, REWORK

Reviewer: koordynator Codex, niezależny od wykonawcy Claude, nie od koordynacji.
Zakres: task_4tpqsy4j2q, base d4fd6b44 → delivered 53b5d2e2; tylko kontrakt/próby.
Receipt PASS: dwa własne commity (5e7c8f26,53b5d2e2), każdy w scope, nowy ledger,
czysty worktree przed tym plikiem review. Niezależne powtórzenie: Python29/29,
TS8/8. To nie dowodzi spełnienia AC całego produktu. Review planu nie otwarte ponownie.

### R20-C01 — false positive wspólnych metadanych (required, AC-07)

Kontrakt §2.6/12.4 utożsamia ten sam common-dir z jednym fizycznym checkoutem.
Git worktrees mają właśnie wspólny common-dir i odrębne realroot/gitdir. Przepis
może błędnie odrzucić poprawnie odizolowane worktree; test receipt dodatkowo nie
realizuje identycznej reguły między child entries. Zastąpić porównaniem faktycznych
checkoutów i jawnego owner/branch/binding, dopuścić współdzielone metadane.
Probe: dwa odrębne worktree tego samego repo z różnymi gitdir/branchami; wspólny
common-dir nie blokuje, dwa aliasy do jednego realroot nadal blokują zapis.
Status: open; blokuje release kontraktu do helpera.

### R20-C02 — niewykryty zapis do ignorowanego katalogu (required, AC-05/08)

ignored_digest w tests/test_multi_repo_contract.py hashuje tylko p.is_file().
Niezależne repro: repo z .gitignore `dist/`, istniejący dist/out; zmiana bytes
before→after pozostawia status `!! dist/` i dokładnie ten sam digest. Zatem próby
29/29 nie dowodzą wykrywania deklarowanego przez kontrakt. Ustalić ograniczony,
kompletny odczyt zawartości istotnych ignorowanych katalogów, bez podążania poza
kontrakt przez symlinki; brak pełnej obserwacji nie daje PASS. Dopisać reprodukcję.
Status: open; blokuje release kontraktu do helpera.

### R20-C03 — reuse przed pierwszą dostawą (required, AC-07)

§4 wymaga przy każdym reuse committed ledger/manifest z delivered HEAD, także gdy
istnieje poprawny checkpoint przygotowania, ale wykonawca jeszcze nic nie dostarczył.
Przerwanie po setupie lub w trakcie pierwszej próby nie spełnia tego warunku.
Dopuścić istniejący checkpoint/kontrakt przypisujący feature, repo, bazę, branch,
realroot/gitdir i initial dirt, potwierdzony bieżącym Git; nie wystarcza nazwa.
Osobno opisać recovery utraconego checkpointu i brak dowodów. Próbki obu faz.
Status: open; zwykła korekta kontraktu w istniejącym zakresie.

### R20-I01 — walidacja ogólna na hoście (open, ograniczenie infrastruktury)

Executor: installer suite61 failures ACTIVE_USE_UNKNOWN, Python2 failures w setup,
pełny npm test przerwany bez końcowego wyniku. Nie zaliczamy tych kontroli. W20-01
wymaga focused probes/docs, nie naprawy instalatora; problem przenieść do wspólnej
walidacji W20-03 i sprawdzić bazę/host. Bez zmiany runtime ani wyłączania kontroli
aktywnego użycia. Wcześniejsze niepowodzenia zachować w ledgerze/historii.

### Raport taska

Bridge PARTIAL/BLOCKED pomimo delivery line COMPLETE: szersze testy nie przeszły,
a znane ograniczenie symlinków jest opisane jak blocker. Przy wznowieniu wykonać
korekty C01…03 i kontraktowe kontrole; raportować ich faktyczny wynik i null blocker
gdy ten bounded kontrakt jest spełniony. Ogólne failures nie znikają i nie są PASS.
Nowy ledger próby, bez nadpisania wcześniejszego. Ten plik jest koordynatora i
pozostaje niecommitowany podczas BLOCKED, żeby nie wejść w zakres commitów workera.

## 2026-11-05 — focused corrections, kontrakt PASS

Task ten sam task_4tpqsy4j2q, próba1 w tej samej sesji (strict resume potwierdzone).
Delivered e84845b6; korekta d3184a88, ledger02 e84845b6; BASE nadal d4fd6b44.
Receipt PASS: cztery własne commity tylko w scope, poprzedni ledger01 niezmieniony;
jedyny dirt to ten jawnie koordynatorski plik. Niezależnie 39 Python +8 TS PASS.

R20-C01 resolved: §2.6/12.4 porównuje realroot/per-worktree gitdir, wspólny common-dir
nie blokuje; dodatnia próbka odrębnych worktree i ujemna aliasów. R20-C02 resolved:
file-level enumeration ignored/untracked + bytes i unfollowed symlink text, jawne
limity dają unknown, nie digest/PASS; reprodukcja dist/out i nested directory działa.
R20-C03 resolved: checkpoint setupu pozwala kontynuować przed pierwszą dostawą,
obejmuje gitdir/branch/bazę/dirt i inwentaryzację wcześniejszej próby; odrębne przypadki
utraty checkpointu i dostarczonego manifestu. Nie zmienia celu briefu.

R20-I01 potwierdzone także na czystej bazie417ddc2 w jednorazowym klonie: test
`bridge-project.test.ts` / `installs the pinned runtime and prepares a clean project
with no runtime id from the caller` FAIL z identycznym ACTIVE_USE_UNKNOWN (pozostałe
68 przypadków nieuruchomione). Build bazy PASS. Ograniczenie hosta pozostaje jawne
dla W20-03, nie udajemy pełnej zielonej regresji. Nie blokuje implementacji helpera.

Lokalna bramka W20-01 zwolniona: kontrakt PASS, W20-02/03 już autoryzowane. To nie
jest PASS implementacji ani odbiór produktu. Testy prototypu nie zastępują testów
produkcyjnego helpera; W20-02 ma go dostarczyć zgodnie z planem (nie opcjonalnie).


## 2026-11-05 — wspólne review W20-02/03, REWORK

Niezależny reviewer: koordynator Codex, nie autor implementacji Claude. Dostawa
021686bd→2fddd673, task_3kfd3z3thk DONE; receipt PASS: cztery commity, każdy w scope,
nowe ledgery, czysty worktree. Przejrzano kanoniczne instrukcje, helper, testy,
wiązanie obu ról i generowane pakiety. Nie ponawiamy review zamkniętego planu.

### R20-E01 — COMPLETE mimo własnej pracy w parent (required, AC-08)

`check_receipt` klasyfikuje dirt dzieci, lecz w parent sprawdza jedynie liczbę wpisów
WORKTREE. Niezależna reprodukcja na jednorazowych repo przez fixture `Receipt`:
`deliver(worktree="dirty:1")`, następnie niezacommitowana zmiana `app/x.txt` w scope.
Wynik CLI: exit0, outcome COMPLETE, findings=[] mimo `M app/x.txt`. Instrukcja §6.5
wymaga PARTIAL dla własnego/overlap dirt w dowolnym repo, a obecny helper tego nie
sprawdza. Dodać jawny baseline parent, klasyfikację oraz regresje własnej pracy,
zachowanego cudzego dirt i nakładania zmian; nie karać automatycznie każdego dirty.
Status: open. Skutek: błędne potwierdzenie kompletności dostawy; naprawa wymagana.

### R20-E02 — mapa nie mieści się w objective (required, AC-06)

bridge-loop nakazuje umieścić całą mapę w objective, ale TaskSpec ma maxLength2000
(shared/protocol/src/schemas.ts). Już mapa sześciu write repo + read dependency
z polami obowiązkowymi może mieć 2814 znaków w zwartym JSON; helper dopuszcza32repo
oraz64KiB. Żądanie odpadnie przed delegacją. Nie rozszerzać protokołu MCP: użyć
krótkiego odwołania do istniejącego lokalnego pliku mapy z hashem i sprawdzaniem
jego treści/tożsamości przed zapisem, dostępnego obu rolom; inline tylko gdy mieści
się razem z celem. Plik jest danymi, nie dodatkową autoryzacją ani instrukcjami.
Test przekazania reprezentatywnej większej mapy, brak/zmiana pliku i limit schematu.
Przy tym ujednolicić pełny preflight obu ról: samo `identity per alias` nie zastępuje
kontroli bindings/read-only/dirt. Nie dodawać nowego silnika egzekucji runtime.
Status: open. Skutek: zgodny z dokumentacją zwykły kontrakt nie uruchamia wykonawcy.

### Walidacja wspólna i R20-I01

Na dostawie: build i focused checks wykonawcy PASS. Niezależnie pełne npm test:
623 PASS,76 FAIL,7 skipped (706); Python188 PASS/2 FAIL (190); pilot140/140 PASS.
Na czystej bazie417ddc2: npm615 PASS/76 FAIL/7 skipped (698); Python111 PASS/2 FAIL
(113). Te same dwa pliki JS instalatora/setup i dwie kontrole CodexHost Python
odmawiają ACTIVE_USE_UNKNOWN przy niepełnym wglądzie w procesy hosta. Pełnej
regresji nie oznaczamy PASS. To odtworzone ograniczenie bazowe, bez zmiany guardów,
bez naprawy instalatora poza zakresem i bez potrzeby powtarzania go w każdej rundzie.

Autoryzacja decyzji03 obejmuje zbiorczą korektę E01/E02 i focused re-review.
Następna runda w tym samym feature/session, nowe ledgery, bez zmiany briefu,
wersji/runtime ani merge/push. Po niej tylko review materialnych zmian i końcowa
walidacja; dodatkowy niezależny agent nie jest potrzebny do powtórzenia tego review.


## 2026-11-05 — focused corrections i zintegrowana dostawa: PASS

Reviewer: koordynator Codex, niezależny od autora implementacji Claude, nie od
koordynacji. Sprawdzono task_vd6jq8ga6c, BASE01eb20da → HEAD09b88a32, kod fd01ab36.
Receipt PASS: dokładna baza, oba commity w scope, nowe ledgery02, wcześniejsze
ledgery/koordynatorskie pliki nietknięte, czysty worktree. Brief ma nadal SHA-256
`ae8bca3467690b6ab884b40ddfcfabc8bdeac4986a0694cb0ffb3abd33ebdc7d`.

- R20-E01 **resolved**: parent.baseline i klasyfikacja bez prefiksu dla parent;
  ta sama niezależna reprodukcja własnego `app/x.txt` teraz exit1/PARTIAL z findingiem.
  Testy obejmują także nietknięty preexisting, nowy foreign i overlap, bez czyszczenia.
- R20-E02 **resolved**: REPO_MAP path+SHA256 zamiast inline, walidacja pliku/hash
  przed preflight/reuse/receipt; scope pozostaje autoryzacją rundy. Test na realnym
  TaskSpecSchema odrzuca duży inline i akceptuje referencję, adapter przenosi ją
  dosłownie. Model w tym teście jest atrapą. Brak/tamper/symlink mapy odrzucane.
  Obie role wymagają pełnego preflight; `identity` nie jest jego substytutem.
- R20-C01…03 pozostają **resolved**, 39 dawnych probes PASS. Nie ma nowej zmiany,
  która uzasadniałaby otwieranie tych ustaleń albo trzeci audyt tego samego problemu.
- R20-I01 **osobne ograniczenie środowiska**, open: pełne suite nie są zielone.
  Na09b88a32 JS625PASS/76FAIL/7skip, Python194PASS/2FAIL. Listy nieudanych przypadków
  identyczne z czystą bazą417ddc2, bez nowych failures. Nie wyłączono guardów.

Build, packages:check (digest155ee41b931f), dokumentacja251 i diff check PASS.
Pilot tooling140/140 na2fddd673; odtąd brak zmian tools/pilot i zależności.
Komendy, wersje, zakres i pokrycie AC w [ledgerze integracji](../execution/integration/01.md).
Wszystkie nowe testy funkcji (41 helper +39 kontrakt +10 TS transport) przechodzą,
podobnie testy local-delivery/exchange/pakietów. Nie przypisujemy ich modelom.

### R20-N01 — doprecyzowanie zakresu kontroli pinów (P3, nonblocking follow-up)

Helper `integration` mechanicznie porównuje SHA wpisu `git ls-tree`; pole `pins`
obsługuje więc gitlinki, a nie dowolny format lockfile/manifestu pakietów. Instrukcja
§8 ogólnie wymaga aktualizacji pinów wszystkich repo i review wynikowej integracji;
konkretne pliki zależności nadal wymagają kontroli projektu przez koordynatora.
Dowód: `integration()` / pętla pins, test IntegrationStatus na gitlinku. Skutek:
nie traktować zielonego helpera jako dowodu poprawności dowolnego lockfile.
Rekomendacja: doprecyzować opis pola pins przy następnej zmianie dokumentacji;
nie dodawać uniwersalnego parsera ani nowej rundy featura. Status: deferred jako
nieblokujące doprecyzowanie dokumentacji w ramach stałej preferencji użytkownika.
Nie zwalnia to z obecnego wymagania review wszystkich zależności/pinów (AC-09).

### Wynik i granice

Cały uzgodniony wynik W20-01…03 dostarczony na poziomie workflow/helpera oraz
zatwierdzonych syntetycznych scenariuszy; brak wymaganych korekt produktu.
PASS dotyczy tego zakresu, nie pełnego zielonego środowiska ani dowodu posłuszeństwa
modeli. Nie było real-agent pilota nowej procedury, zmian rzeczywistych child repo,
merge/push/release/upgrade. Helper jest tylko do odczytu, nie sandboxem/runtime guardem.
Rekomendacja Gate2: przedstawić tę lokalną dostawę do rzeczywistego odbioru użytkownika.

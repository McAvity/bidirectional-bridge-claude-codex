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

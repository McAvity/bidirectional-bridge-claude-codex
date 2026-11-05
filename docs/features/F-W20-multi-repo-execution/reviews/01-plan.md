# F-W20 — niezależne review planu (tryb `plan`)

## Podsumowanie

**Werdykt: REWORK.** Jest jedna wymagana korekta. To poprawka zakresu W20-01 i designu, a nie przeprojektowanie.

Plan realizuje cel użytkownika: dokumenty powstają w dowolnym checkoutcie, a środowisko child repo przygotowuje dopiero `feature-execute`. Dostawa ma osobny receipt dla każdego repo i nie odwołuje się sama do siebie, `changed_scope` zostaje płaską tablicą, a integracja może być częściowa i da się ją kontynuować. Kolejność W20-01 → W20-02 → W20-03 jest wykonalna i nie wymaga nowej decyzji produktowej. Jedno istotne założenie nie zostało sprawdzone: czy wykonawca i koordynator w ogóle mogą zapisywać do checkoutu child przez alias. Plan nie wskazuje, gdzie W20-01 miałby to wykryć.

**Następny krok:** koordynator dopisuje R20-P01 do design.md i W20-01, razem z wybranymi uwagami opcjonalnymi. Potem wystarczy jego własne, skupione sprawdzenie tej poprawki i Gate 1. Nie potrzeba nowej rundy pełnego review. Ten raport nie jest zgodą na wykonanie.

## Wejścia i zakres

- Worktree `design/multi-repo-execution (worktree)`, `HEAD=082e4b767384d3f9754205cbee930943f2baece9`, drzewo czyste.
- `brief.md`: SHA-256 `ae8bca34…33ebdc7d`, zgodny z oczekiwanym.
- Przeczytane w całości:
  - design.md, feature.json, PROGRESS.md, W20-P01, W20-01…03;
  - `.agents/skills/feature-review/SKILL.md`, `feature-execute/SKILL.md`, `references/local-delivery.md`, część `bridge-loop.md`;
  - fragmenty `docs/features/README.md`.
- Sprawdzony kod:
  - `shared/protocol/src/scope.ts`;
  - `schemas.ts` (DeliverableSchema);
  - `deliverable-service.ts`;
  - `claude-adapter.ts`;
  - `claude-code-runner.ts` (buildArgs: `--add-dir`, permission mode);
  - `scripts/native-bridge-mcp.mjs` (opcje runnera i Codexa);
  - `generate.mjs` (copyTree, rewrite);
  - `feature_exchange.py` (namespace, symlink/submodule);
  - lista testów w `tests/test_local_delivery.py`.
- Zgodność bazy: `git diff 5257ca6..HEAD` poza `docs/` i `work-items/` zmienia tylko `.bridge-project/bridge.json` (pin runtime). Kod istotny dla F-W20 na bazie 417ddc2 jest więc identyczny z 5257ca6.

## Ustalenia wymagane

### R20-P01 — nie sprawdzono, czy da się zapisywać do child checkoutu przez alias i przy jakich uprawnieniach

- **Wymaganie:** brief mówi, że plan ma sprawdzić, czy realizacja wymaga dodatkowych możliwości silnika, zamiast to zakładać. Dotyczy to AC-02, AC-06 i AC-10 (rutynowe przygotowanie bez dodatkowych pytań).
- **Obserwacja:**
  - Design opiera zapis do zewnętrznego worktree na „lokalnym ignorowanym aliasie” pod parentem i deklaruje, że nie trzeba zmieniać runtime ani API.
  - Próby w W20-01 są „bez modelu” i obejmują tylko walidację scope oraz transport linii dostawy.
  - `context_files` w feature.json nie zawierają runnera ani launchera.
- **Dowody z kodu:**
  - `native-bridge-mcp.mjs:181-189` uruchamia Claude z `permissionMode: "acceptEdits"` i `allowedTools: ["Read","Edit","Write","Bash"]`. Komentarz w kodzie mówi: „Read/Edit/Write remain project-confined by Claude Code”.
  - `claude-code-runner.ts:676-687` buduje `--add-dir` z dosłownego prefiksu globów scope, względnie do `cwd = workspace_root` (parent).
  - Gdy alias jest symlinkiem do katalogu poza projektem, o tym, czy Edit/Write przejdzie, decyduje to, jak Claude Code rozwiązuje symlinki w working dirs i `--add-dir`. W trybie `-p` odmowa nie daje promptu, tylko kończy się PARTIAL albo obejściem przez Bash.
  - Koordynator Codex działa pod sandboxem klienta. Plik `native-bridge-mcp.mjs:203` pokazuje `sandbox: "workspace-write"` dla delegowanego Codexa; sesja managera ma własne ustawienia użytkownika. Wtedy `git worktree add` w zewnętrznym child repo zapisuje do jego `.git` poza parentem.
  - Nieignorowany katalog nested repo lub alias pojawi się w `git status` parenta jako `??`. To psuje `WORKTREE=clean` i klasyfikację dirtu (local-delivery § 3–4).
- **Skutek:** wybrany mechanizm zapisu może nie działać albo zamienić rutynowe przygotowanie w prompty uprawnień. Nie da się tego naprawić w kontrakcie W20-01 bez zawężenia zakresu, a W20-01 w obecnym brzmieniu nie musi tego zauważyć.
- **Dyspozycja:** wymagana korekta planu (specyfikacja), przed Gate 1. Nie wymaga decyzji użytkownika.
- **Rekomendowane rozwiązanie** (dopisać do design.md i W20-01):
  1. Wskazać lokalizację domyślną dla checkoutów zapisywanych przez rundę: fizycznie w ignorowanej ścieżce parenta, z realpath wewnątrz projektu, bez symlinka. Zewnętrzny checkout z aliasem dopuścić tylko po wykazaniu dostępu.
  2. Ustalić, jak ta ścieżka jest ignorowana bez zmiany śledzonego `.gitignore`. Na przykład `info/exclude` jako wspólne metadane Git, co pkt 6 briefu akceptuje. Plan powinien też określić skutek dla `WORKTREE`.
  3. W W20-01 dodać test bez modelu, który pokazuje, jakie `--add-dir` runner wygeneruje dla scope aliasu.
  4. Zapisać wymagane uprawnienia klienta: Claude Edit/Write/Bash poza projektem oraz writable roots koordynatora Codex.
  5. Jeśli zachowania symlinków w Claude Code nie da się wykazać bez modelu: albo oznaczyć je jako niezweryfikowane ograniczenie z fallbackiem z punktu 1, albo zaplanować probe z budżetem ustalonym przed startem, zgodnie z briefem.

## Uwagi nieblokujące

Do zbiorczego przyjęcia albo odrzucenia przez koordynatora.

- **R20-P02** — local-delivery § 3.3 pozwala commitować po kontrolach tylko ledger. Manifest `multi-repo-v1` zawiera dowody kontroli, więc też musi powstać po nich. Kontrakt W20-01 powinien jawnie rozszerzyć ten wyjątek na manifest jako załącznik ledgera (bez kodu). **Dyspozycja:** spec, w ramach W20-01.
- **R20-P03** — local-delivery § 2 każe stawiać linię `PACKAGE=…` jako drugą, a design wymaga, by druga była `REPOS=…`. Gdy kontrakt wymaga obu, kolejność jest niezdefiniowana. Wystarczy dopisać kolejność do „transportu obu linii” w W20-01. **Dyspozycja:** spec.
- **R20-P04** — przy reuse bez checkpointu (np. po wyczyszczeniu lokalnego katalogu exchange) design wymaga „odtworzenia z dowodów”, ale nie mówi, z jakich. Proponowany dowód: zcommitowane manifesty lub ledger z repo ID, branchem i bazą, oraz to, że HEAD child pochodzi od zapisanej bazy przez zapisane commity. Sama nazwa brancha nie wystarcza. Kontrakt powinien wymienić minimalny dowód własności. **Dyspozycja:** spec, W20-01.
- **R20-P05** — merge bez fast-forward tworzy nowe SHA, a aktualizacja pinów to nowy commit parenta po zrecenzowanym HEAD. Trzeba wskazać, że testy zintegrowanego zestawu biegną na wynikowych SHA i że commit z pinami jest sprawdzany osobno jako dryf integracji. Ogólna reguła feature-execute już to obejmuje; warto ją przywołać w scenariuszu W20-03. **Dyspozycja:** nota.
- **R20-P06** — w fixtures submodule (W20-01) warto sprawdzić, gdzie Git trzyma gitdir submodułu w linked worktree parenta i co `submodule init` zapisuje do wspólnego configu. Chodzi o to, żeby nie uznać tego błędnie za naruszenie izolacji ani nie przeoczyć współdzielenia. **Dyspozycja:** nota, dowód w W20-01.

## Ocena obszarów wskazanych w zleceniu

- **Aliasowanie scope w MCP.** `normalizePath` odrzuca `..` i ścieżki absolutne, więc alias jest wymagany. Lease działa na tekstowych globach, a design trafnie nie obiecuje ochrony fizycznej. `changed_scope` to płaska tablica, element do 512 znaków, a `deliverable-service` przechowuje ją bez walidacji względem scope. Projekt jest poprawny poza R20-P01.
- **Receipt per repo bez odwołania do samego siebie.** Linia 1 niesie HEAD parenta, a manifest jest w tym HEAD i nie zawiera własnego hasha (hash jest w linii 2). Odbiorca sam czyta Git każdego repo z realpaths z kontraktu, nie ufając manifestowi. Cyklu nie ma. Obie linie mieszczą się w 4000 znaków. Poprawne, uzupełnienia w P02 i P03.
- **Izolacja: lokalne zależności i submoduły.** Uwzględnione są pakiety lokalne, build, hooki i codegen. Komenda z nieustalonym celem zapisu zostaje wstrzymana, zależność read-only jest dopuszczona, wspólne metadane i cache nie są błędem. Submoduł traktowany jest jak osobne repo z gitlinkiem jako osobnym wpisem. Kompletne, nota P06.
- **Automatyczne przygotowanie i reuse.** Przygotowanie robi agent zwykłym Git, bez bramki zgody. Reuse wymaga dowodu, kolizja daje nową nazwę i zapis, nigdy reset. Kompletne, z warunkiem R20-P01 (uprawnienia) i notą P04.
- **Autoryzowana częściowa integracja.** Kolejność dependency-first, wynik dla każdego repo, bez udawanej atomowości i bez resetu, push i deploy osobno. Kompletne, nota P05.
- **F-W19.** Słusznie nie jest zależnością. Design opisuje skutek dystrybucji i scalenie zmian w shared skills i generatorze. Generator kopiuje całe drzewo skilla (`copyTree`), a `.agents/skills/` przepisuje generycznie, więc `feature-execute/scripts/multi_repo.py` trafi do paczek bez zmian w generatorze.

## Pokrycie AC (na poziomie planu)

| AC | Ocena | Uzasadnienie |
| --- | --- | --- |
| AC-01 | pokryte | design „Przygotowanie dopiero w execute”; scenariusze W20-02 i W20-03 |
| AC-02 | pokryte warunkowo | wymaga R20-P01 |
| AC-03 | pokryte | kolizja, cudzy dirt (design, W20-03) |
| AC-04 | pokryte | realpath, alias, blokada zależnych zapisów |
| AC-05 | pokryte | zapis przez dependency, wstrzymanie komendy z nieustalonym celem |
| AC-06 | pokryte warunkowo | W20-02 wpina procedurę w sekcję wykonawcy; ścieżka zapisu zależy od R20-P01 |
| AC-07 | pokryte | checkpoint w namespace, ponowna kontrola przy dryfie, nota P04 |
| AC-08 | pokryte | manifest i niezależny odczyt Git każdego repo |
| AC-09 | pokryte | dependency-first, częściowy merge widoczny, nota P05 |
| AC-10 | pokryte instrukcyjnie | dokumentacja i scenariusze W20-03; brak pytań o rutynowe przygotowanie da się wykazać tylko na poziomie instrukcji, bez pilota agenta (dozwolone przez brief, ograniczenie ma trafić do raportu) |

Cel użytkownika nie jest jeszcze osiągnięty, bo istnieje tylko plan. Wszystkie bramki są przed nami: Gate 1, wykonanie i odbiór.

## Ograniczenia review

- Nie uruchamiałem testów, modeli, generatora ani Git zapisującego.
- Zachowania Claude Code (symlinki, `--add-dir`) i sandboxa koordynatora nie sprawdzałem empirycznie, dlatego R20-P01 dotyczy brakującego dowodu, a nie wykazanego defektu.
- `bridge-loop.md` przeczytałem tylko w części dotyczącej kontraktu, a `README.md` przez wybrane fragmenty.
- Reviewer jest niezależny od autora planu, ale działa w ramach tej samej koordynacji bridge’a.


## Pochodzenie zapisu

Raport niezależnego Claude przez bridge. Oryginalny artefakt: SHA-256 `914fe927f00caf503c431d502427b66ea2b2d6a92a7a6af540b01a1cbda79887`; integralność sprawdzona. Publiczna kopia pomija powielony JSON i lokalizację hosta. Wszystkie findingi zachowane.

Uściślenie koordynatora: normalizePath usuwa początkowy `/`, a nie odrzuca wszystkich ścieżek absolutnych. Plan nadal prawidłowo wymaga wyłącznie repo-relative globs; nie korzysta z tej normalizacji jako mapowania ścieżek absolutnych.


## 2026-11-05 — focused corrections review

## Verdict: PASS. R20-P01 is resolved, and no required issue remains.

**Revision reviewed:** `design/multi-repo-execution (worktree)` at HEAD `ff426d2da6b4622f6ca9efe18b7c451919fb6198`, read only. I checked the diff `9867321..ff426d2`: PROGRESS.md, design.md, feature.json, W20-01.md and W20-03.md. I also read `reviews/01-plan.md` and `decisions/01.md`. The brief's SHA-256 is still `ae8bca34…33ebdc7d`, so it is unchanged. This is a review of the plan only. It does not approve implementation or Gate 1.

### R20-P01: resolved
I checked each of the review's five recommended points against the corrected plan and the code.

1. **Default placement.** New checkouts now default to a physical directory inside the parent, in a private untracked task directory (`.feature-repos/<feature-id>/<repo-id>`), with no symlinks on the path. An external alias is allowed only after access is shown for both roles. Existing external environments are not moved silently. Because the default is under `cwd`, it no longer depends on how Claude Code resolves symlinks.
2. **Ignoring the directory.** The plan adds only the exact task directory to the file returned by `git rev-parse --git-path info/exclude`, keeps existing entries, and leaves the tracked `.gitignore` alone. It notes this file may be shared Git metadata, uses `check-ignore` plus parent status as proof, and keeps a tracked submodule gitlink tracked. I tested this in a throwaway repo:
   - in a linked worktree, the exclude file is the shared one in the main repo's `.git`;
   - `git status --porcelain=v1 --untracked-files=all` came back empty, so `WORKTREE` stays clean;
   - `check-ignore` matched the entry.
3. **Runner argv test.** W20-01 now covers runner argv for both a physical child and an alias. This matches the code: `claude-code-runner.ts:678-687` turns scope prefixes into `--add-dir` paths relative to the parent.
4. **Client permissions.** The plan names the real limits: the runner's `acceptEdits` plus `--add-dir`, and the manager's own sandbox and writable roots. It says an argv test does not prove Edit/Write works through a symlink, and it forbids getting around an Edit/Write refusal with Bash. It also forbids turning off the sandbox, and states that a local worktree may need writes to the child's Git directory outside the parent.
5. **Fallback when access is unproven.** The plan falls back in order: a physical local checkout, then a new isolated clone inside the parent that keeps the authorized source and base. If neither works, only the dependent writes are blocked. This stays within the brief's line 167 (check, don't assume, the need for new engine capabilities). It also fits AC-02 and AC-06 (one setup path that works without new runtime features) and AC-10 (no product gate; host-level prompts are only stated as a limitation).

`context_files` now includes the runner and `native-bridge-mcp.mjs`. Scope globs under `.feature-repos/...` still pass `normalizePath`, because single dots are fine and only `..` is rejected. The erratum on `normalizePath` is recorded, and the plan still requires repo-relative scopes.

### R20-P02 to P06: all adopted, no regressions found
- **P02:** the exception for committing the ledger after the checks now also covers the evidence-only manifest.
- **P03:** the line order is DELIVERY, REPOS, PACKAGE when a ZIP is required, within the 4000-character limit and without truncating hashes. Single-repo order stays DELIVERY, PACKAGE.
- **P04:** the minimum reuse evidence is now defined: a ledger or manifest naming repo, feature, branch and base, confirmed by the actual checkout, commits and ancestry. A branch name or shared remote alone is not enough.
- **P05:** after a non-fast-forward merge or pin update, the resulting SHAs are re-checked, and the pin commit is reviewed separately as integration drift. This is in the design and W20-03.
- **P06:** W20-01 now probes the submodule's Git directory location in a linked parent and what `submodule init` writes to the shared config.

### Optional notes (not gates; can go into the W20-01 contract)
- **O1. Losing commits in the clone fallback (tested).** In the throwaway repo, `git worktree remove <parent>` without `--force` succeeded. It deleted the parent along with an ignored nested child repo that held a commit. For the default nested worktree, the child's commits survive in its own repo and only uncommitted work is lost. For an in-parent clone, though, commits not yet integrated exist only inside the parent. The contract and docs should say the nested checkout lives and dies with the parent: integrate or move the clone before removing the parent worktree. Automatic cleanup stays out of scope, as the brief says.
- **O2. Delegated Codex can't escalate.** Delegated Codex runs with `approval_policy: "never"` and the `workspace-write` sandbox (`native-bridge-mcp.mjs:198-204`), so the plan's "permissions/escalation" option does not exist for it. When choosing between a worktree and a clone, the deciding question should be whether that executor can write the child's Git directory outside the parent. Failing that safely is already covered by the clone fallback or a block.
- **O3. Parent tools may scan the nested checkout.** The parent's own build, test, lint or search commands may descend into `.feature-repos/`. The contract could tell them to exclude it.
- **O4. Name the WORKTREE effect.** The design could say outright that `WORKTREE` stays clean. The test above confirms it does.

### Limitations
- I did not run any models or check Claude Code's symlink behaviour in practice. That is now correctly a W20-01 probe, not a premise of the plan.
- The scratch Git test ran in a temporary directory, which I deleted afterwards. Nothing in the target repo was written, committed or installed, and the runtime and modelpilot were not touched.


Oryginalny artefakt SHA-256 `3a8e8e329b6efcaf54232af8aa350b17493c16d665056dce654c897b9d24b443`; integralność potwierdzona. Usunięto wyłącznie lokalną ścieżkę hosta i powielony JSON. O1…O4 zachowane jako nieblokujące uwagi tego review.

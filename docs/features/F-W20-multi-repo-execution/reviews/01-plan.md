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

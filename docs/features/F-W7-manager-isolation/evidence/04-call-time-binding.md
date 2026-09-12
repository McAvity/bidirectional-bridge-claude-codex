# Weryfikacja kierunku call-time binding (decyzja 06)

Data: 2026-09-12; źródła Codex rust-v0.154.0 / 6b9826e3aa83b1a5947db50f4332cb9c65f1b340, provenance jak evidence/03. Odczyt niezależnego drugiego Codexa, porównany przez koordynatora z zapisanym syntetycznym native wire. Bez zmian produktu i bez nowej próby modelu.

Wariant jest wykonalnym kandydatem w zaakceptowanej granicy accidental-mixup. Użytkownik świadomie wyznacza pierwszego uprawnionego wywołującego operację własności jako managera; nie należy zachowywać wcześniejszego, sprzecznego z decyzją 06 wymagania odgadnięcia wcześniej wyznaczonego managera przed pierwszym wywołaniem. Samo _meta.threadId ustala dokładny thread, ale nie jego rolę root/subagent.

## Nowe dowody źródłowe niezależnego review

- core/src/guardian/reviewer_config.rs:67–73 zeruje wszystkie mcp_servers, a nieudane ustawienie jest błędem. W89–110 wyłącza Apps/Plugins. Produkcyjny guardian/review.rs:879–885 używa tego buildera. guardian/tests.rs:3902–3941 sprawdza pustą konfigurację. To odczyt istniejącego testu, nie jego wykonanie tutaj. Normalny guardian w tej wersji nie dostaje narzędzi bridge; nie może wygrać pierwszego mutatora na tym kanale.
- core/src/mcp_tool_call.rs:1250–1262 dodaje obiekt _meta["x-codex-turn-metadata"].
- core/src/responses_metadata.rs:376–406,534–542 serializuje session_id/thread_id oraz opcjonalne parent_thread_id/subagent_kind/thread_source. Pochodzenie subagent_kind z host SessionSource:445–455; klucze zastrzeżone przed nadpisaniem dodatkowymi metadanymi app-server:58–87.
- core/src/turn_metadata.rs:234–248 usuwa z MCP agent_name/parent_turn_id/root_turn_id, ale nie wymienione pola tożsamości.

## Dodatkowa obserwacja istniejącej próby binarki

Trzy wywołania A/B/A z evidence03 niosły _meta["x-codex-turn-metadata"] jako obiekt. Wszystkie miały session_id == thread_id == _meta.threadId. Obecne były także codex_version i inne dane tury. Nie było parent_thread_id, subagent_kind ani thread_source. Źródło app-server root zgłoszone wcześniej jako vscode. Nie publikujemy wartości natywnych ID. To dowodzi, że wymaganie obecności thread_source dla każdego zwykłego roota odrzuciłoby poprawną zaobserwowaną ścieżkę.

## Konsekwencje do korekty kontraktu

Bez hooka/launchera jako domyślnej zależności. Użyć per-request native metadata, spójności trzech ID, odrzucania subagent_kind/parent_thread_id i sprzecznych danych, plus jawnego adaptera dla zweryfikowanej wersji/kształtu. Przed pierwszym ownership sprawdzić poprawność operacji i metadanych; dopiero uprawniony mutator atomowo tworzy binding i zapis. Same odczyty/handshake nie wiążą. Kolejne mutacje sprawdzają binding/epoch, obcy root wymaga jawnego takeover. Pierwsze równoczesne roota rozstrzyga atomic reservation+transaction, nie globalna zmienna ostatniego requestu.

Nie twierdzić, że brak subagent_kind dowodzi source=Cli: Internal/Unknown też nie ustawiają tego pola. Ustalić dokładną wspieraną semantykę i ograniczenia; wymóg wyłącznie interaktywnego Cli nie został dodany przez użytkownika. Gwarancja nie obejmuje świadomego fałszowania hosta przez proces tego samego UID. Jeśli istnieje realny wewnętrzny klient mogący spełnić root envelope i omyłkowo wywołać ownership przez MCP, wykonawca ma przedstawić konkretny kontrprzykład oraz minimalny brakujący kanał zamiast twierdzić, że optional thread_source wszystko rozstrzyga. Nie dopisywać niezweryfikowanego runtime lookup jako gotowego rozwiązania.

Wymagane testy kontraktu obejmują guardian bez bridge MCP, spreparowaną syntetyczną kopertę subagenta odrzuconą przed zapisem, brak/pomyłkę pól, równoczesne first calls dwóch rootów, readonly-first, failed-operation-first, resume i takeover. Test syntetycznej koperty nie jest realnym wywołaniem guardiana. Ostateczna ocena kontraktu pozostaje po dostawie Claude’a.

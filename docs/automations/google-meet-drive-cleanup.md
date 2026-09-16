# Rotina: Consolidar transcrições do Google Meet

> Documentação de referência de uma Routine (rotina agendada) criada no chat do claude.ai
> pela usuária (maisa@institutomain.com). Trazida para este repositório apenas como
> especificação/inspeção — nenhuma automação foi implementada em código a partir disto ainda.

## Onde ela roda hoje

- **Tipo**: Routine (trigger agendado) do claude.ai, não é código deste repositório.
- **Trigger ID**: `trig_01GRrwEmAKdgkwM5c484JWem`
- **Cron**: `44 * * * *` (de hora em hora, no minuto 44)
- **Sessão vinculada**: sessão persistente própria (`session_01FS7KcdFiKvMHdrJgirQmvz`), separada
  desta sessão de código.
- **Ferramentas usadas**: conector MCP do Google Drive (`mcp__Google_Drive__*`).
- **Status**: habilitada, últimas execuções com sucesso.

## Contexto do problema

O Gemini no Google Meet cria uma pasta nova por reunião dentro de uma pasta chamada
"Google Meet" em "Meu Drive". O Google às vezes cria **mais de uma** pasta "Google Meet"
direto na raiz do Meu Drive (comportamento observado, não confiável ter um único ID fixo).

A usuária quer consolidar diariamente os documentos de anotações soltos na pasta
**"Meet Recordings"** (id: `17VtBWSRbOt44rCNPGNxC2hXBifiNohzQ`).

Pasta "Google Meet" original/oficial (pode ficar vazia sem ser apagada):
`1ne0Dup6ZXXvad44puUDm1VL0KO-4bACO`.

## Lógica passo a passo

1. Buscar todas as pastas chamadas "Google Meet" na raiz do Meu Drive
   (`title contains 'Google Meet' and parentId = 'root'`) — pode haver mais de uma.
2. Para cada pasta "Google Meet" encontrada, listar suas subpastas (uma por reunião).
3. Para cada subpasta de reunião, buscar o(s) doc(s) "Anotações do Gemini" dentro dela.
4. Se houver doc(s):
   - Mover cada um para "Meet Recordings" (atualizando `parentId`).
   - Apagar (trash) a subpasta de reunião, agora vazia.
5. Se a subpasta ainda estiver vazia (reunião recente, nota ainda sendo gerada), pular e
   deixar para a próxima execução.
6. **Antes de apagar qualquer pasta "Google Meet" da raiz**: repetir a busca de conteúdo
   imediatamente antes do trash, para confirmar que ela está mesmo vazia (pode ter surgido
   uma subpasta nova entre a varredura inicial e o momento de apagar). Se aparecer algo
   novo, processar esse item primeiro. Nunca apagar a pasta oficial
   (`1ne0Dup6ZXXvad44puUDm1VL0KO-4bACO`) — ela pode ficar vazia sem problema.

Regra geral de segurança: **nunca apagar uma pasta sem confirmar seu conteúdo com uma
busca feita naquele exato momento** — não confiar em uma listagem feita minutos antes.

## Comportamento de notificação

A rotina trabalha em silêncio quando tudo corre normalmente. Só deve chamar atenção da
usuária em casos fora do padrão:
- Subpasta com múltiplos documentos de pessoas diferentes.
- Erro de permissão.
- Grande quantidade de pastas acumuladas (sinal de que a rotina não rodou por vários dias).

## Possíveis próximos passos (não implementados)

Se decidirmos portar isso para automação de verdade dentro deste repositório (ex: uma
rota de API + cron job usando a Google Drive API diretamente, em vez do conector MCP),
pontos a decidir:
- Autenticação: OAuth da conta da usuária vs. service account com acesso à pasta.
- Onde agendar: cron do provedor de hosting (Vercel Cron, etc.) vs. manter como Routine.
- Idempotência e tratamento de concorrência (o cuidado do passo 6 acima existe justamente
  por causa de uma corrida observada entre varredura e exclusão).

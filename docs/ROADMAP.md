# Roadmap

Cada etapa deverá produzir algo testável antes de avançar.

## Etapa 0 — Fundação

- [x] Criar repositório independente.
- [x] Registrar princípios e arquitetura inicial.
- [x] Definir módulos e escopo de alto nível.
- [ ] Definir licença e política de terceiros.
- [ ] Registrar decisões de empacotamento de mídia.

## Etapa 1 — Protótipo desktop

- [ ] Criar aplicação Tauri 2 + React + TypeScript.
- [ ] Implementar tema Social Nexus e layout principal.
- [ ] Abrir e salvar projeto vazio.
- [ ] Importar arquivos e obter metadados via FFprobe.
- [ ] Testar Windows, macOS e Linux.

**Critério:** abrir a aplicação, criar projeto, importar mídia e reabrir sem perder referências.

## Etapa 2 — Timeline básica

- [ ] Modelo de faixas e clipes.
- [ ] Exibir thumbnails e waveform.
- [ ] Mover, cortar, dividir e redimensionar clipes.
- [ ] Undo/redo.
- [ ] Preview sincronizado.

## Etapa 3 — Montagem automática

- [ ] Importação em lote.
- [ ] Interpretar timestamps em nomes de arquivos, inclusive milissegundos.
- [ ] Identificar duplicados e timestamps inválidos.
- [ ] Alertar sobre mídia após o fim da narração.
- [ ] Permitir ajustes manuais.

## Etapa 4 — Áudio e legendas

- [ ] Múltiplas faixas de áudio.
- [ ] Volume, fades e sincronização.
- [ ] Importar SRT e VTT.
- [ ] Estilos, posição e modos de exibição de legenda.

## Etapa 5 — Efeitos e composição

- [ ] Transformações de escala e posição.
- [ ] Keyframes.
- [ ] Ken Burns para imagens.
- [ ] Transições, overlays, logo e marca d'água.
- [ ] Controle de velocidade.

## Etapa 6 — Renderização

- [ ] Pipeline FFmpeg.
- [ ] MP4 com H.264 e opções compatíveis.
- [ ] Resoluções e FPS configuráveis.
- [ ] Detecção de encoder por hardware e fallback CPU.
- [ ] Progresso, cancelamento e histórico.
- [ ] Testes de sincronização de áudio e vídeo.

## Etapa 7 — Desempenho e distribuição

- [ ] Proxies e cache inteligente.
- [ ] Autosave e recuperação.
- [ ] Templates e presets para redes sociais.
- [ ] Detecção de silêncio.
- [ ] Render em segundo plano.
- [ ] Instaladores e testes de atualização.

## Proporções de saída

| Proporção | Dimensão de referência |
|---|---:|
| 16:9 | 1920 × 1080 |
| 9:16 | 1080 × 1920 |
| 1:1 | 1080 × 1080 |
| 3:4 | 1080 × 1440 |
| 4:5 | 1080 × 1350 |
| Personalizada | Definida pelo usuário |

As dimensões são referências iniciais. A exportação deverá permitir outras resoluções respeitando limites de codec e hardware.
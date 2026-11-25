# Arquitetura inicial

## Objetivo

Editor desktop local-first para Windows, macOS e Linux. Interface, modelo de edição, processamento de mídia e renderização serão separados para facilitar manutenção e testes.

## Camadas

- **Desktop:** Tauri 2, janela, integração com sistema operacional, permissões e empacotamento.
- **Interface:** React + TypeScript, biblioteca de mídia, preview, timeline e painéis de propriedades.
- **Núcleo Rust:** sistema de arquivos, processos FFmpeg/FFprobe, filas, cancelamento, detecção de hardware e persistência.
- **Módulos internos:** projeto, mídia, timeline, áudio, legendas, efeitos e renderização.

## Módulos previstos

| Módulo | Responsabilidade |
|---|---|
| project-engine | Formato do projeto, assets, autosave e migrações |
| media-engine | Importação, metadados, thumbnails e análise |
| timeline-engine | Faixas, clipes, operações e posicionamento |
| audio-engine | Mixagem, volume, fades e filtros |
| caption-engine | SRT/VTT, temporização e estilos |
| effects-engine | Transformações, overlays e transições |
| render-engine | Plano de renderização, FFmpeg e progresso |

Os módulos poderão começar como partes internas do monorepo. A separação em pacotes ou crates será aplicada quando trouxer benefício real.

## Formato de projeto

O formato planejado é `.sveproj`, baseado em JSON versionado. Deve armazenar configurações do projeto, resolução, proporção, FPS, faixas, clipes, referências de mídia, efeitos, keyframes e legendas.

Os caminhos devem ser relativos sempre que possível. O projeto não incorpora nem modifica os arquivos originais. Alterações incompatíveis exigirão migração explícita; dados não poderão ser descartados silenciosamente.

## Precisão temporal

A representação interna usará unidades inteiras precisas, preferencialmente microssegundos ou ticks com base definida. A interface poderá exibir segundos e milissegundos. Conversões para frames devem respeitar o FPS, inclusive taxas fracionárias.

## Pipeline de mídia

FFmpeg e FFprobe serão executados pelo backend Rust. O sistema deverá detectar encoders disponíveis, oferecer aceleração por hardware quando compatível e fallback por CPU. Não presumir que NVENC, QSV ou VideoToolbox estejam disponíveis.

Capturar progresso, erros e código de encerramento; permitir cancelamento e limpeza de temporários. A distribuição do FFmpeg e codecs depende de auditoria de licenças e testes multiplataforma.

## Desempenho

- Proxies opcionais para mídia pesada.
- Cache de thumbnails, waveform e preview.
- Limites configuráveis para tarefas simultâneas.
- Render final usando os arquivos originais.
- Monitoramento de memória e tratamento de falhas.
- Perfil econômico para hardware com VRAM limitada.

## Interface

Áreas principais: biblioteca de mídia, preview, timeline multifaixa, propriedades, áudio, legendas e exportação. A identidade visual seguirá a paleta Social Nexus do README, com contraste adequado e suporte a diferentes tamanhos de janela.

## Segurança e privacidade

- Nenhum upload de mídia por padrão.
- Acesso a arquivos limitado a caminhos autorizados.
- Não concatenar entradas do usuário em comandos shell.
- Validar projetos importados.
- Fixar e auditar dependências.
- Sem telemetria obrigatória.

## Testabilidade

Cada módulo deverá ter testes unitários. O pipeline de renderização terá testes de integração com arquivos pequenos e resultados verificáveis. Mídias de teste precisam ter origem e licença documentadas.

## Decisões em aberto

- Empacotamento do FFmpeg por sistema operacional.
- Biblioteca de waveform e preview.
- Estratégia de composição e transições.
- Licença do aplicativo.
- Atualização automática.
- Formatos adicionais de exportação.
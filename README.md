# Social Video Editor

Editor de vídeo desktop, local e multiplataforma da Social Nexus.

## Status

**Fase atual: fundação e especificação.** Este repositório está sendo iniciado com arquitetura e documentação próprias. Ainda não é uma versão executável do editor.

## Princípios

- Local-first: arquivos e projetos permanecem no computador.
- Multiplataforma: Windows, macOS e Linux.
- Edição não destrutiva: os arquivos originais não são alterados.
- Desempenho adaptável: proxies, cache e encoder conforme hardware disponível.
- Privacidade: nenhuma mídia enviada a servidores por padrão.
- Licenças de dependências e recursos de terceiros serão auditadas.

## Tecnologias planejadas

- Tauri 2 para a aplicação desktop.
- React + TypeScript para a interface.
- Rust para integração com o sistema, arquivos e tarefas.
- FFmpeg para processamento de mídia e renderização.

## Recursos planejados

- Importação em lote de narração, imagens, vídeos e músicas.
- Montagem automática por timestamps nos nomes dos arquivos.
- Timeline multifaixa com corte, divisão, movimentação e redimensionamento.
- Preview, waveform, áudio, fades e sincronização.
- Legendas SRT/VTT com estilos e modos de exibição.
- Transições, efeitos, overlays, marca d'água e Ken Burns.
- Proporções 16:9, 9:16, 1:1, 3:4, 4:5 e dimensões personalizadas.
- Exportação MP4, configurações de resolução, FPS e encoder.
- Proxies, cache, autosave e recuperação de projetos.

## Identidade visual Social Nexus

- Fundo principal: `#0c0c10`
- Painéis: `#14141a`
- Rosa: `#ec4899`
- Laranja: `#fb923c`
- Gradiente principal: rosa para laranja.

A implementação visual será própria deste aplicativo, sem copiar código de outro repositório.

## Estrutura planejada

```text
apps/desktop/       Aplicação Tauri + React
packages/           Engines internos
resources/          Presets e templates
docs/               Arquitetura e decisões
tests/              Testes e mídias de referência
```

## Documentação

- [Arquitetura](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)
- [Decisões técnicas](docs/decisions/README.md)

## Desenvolvimento

As instruções de instalação serão adicionadas quando o primeiro esqueleto executável estiver pronto. Ainda não há instalador ou build funcional publicado.

## Licença

A licença do aplicativo será definida antes da primeira distribuição pública. As licenças das dependências e componentes empacotados também serão documentadas.
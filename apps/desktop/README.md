# Aplicação desktop — Social Video Editor

## Estado do protótipo

A primeira interface funcional está em desenvolvimento. Esta versão já permite importar mídias para a sessão, selecionar e pré-visualizar imagens/vídeos/áudios, adicionar itens a faixas visuais de timeline e exportar/importar um snapshot `.sveproj`.

**Limitações atuais:** a timeline ainda não possui arraste, corte, redimensionamento ou sincronização de reprodução; os clipes recebem duração inicial provisória de 5 segundos. O snapshot guarda estrutura e nomes de arquivos, mas não incorpora os arquivos de mídia. Ao reabrir, importe novamente as mídias. Não há renderização de vídeo/FFmpeg nesta etapa.

## Requisitos de desenvolvimento

- Node.js 20 ou superior e npm.
- Rust toolchain estável.
- Dependências nativas exigidas pelo Tauri 2 no sistema operacional. Consulte o guia oficial de pré-requisitos do Tauri para Windows, macOS ou Linux.

## Executar em desenvolvimento

Na raiz do repositório:

```bash
npm install
npm run dev
```

O comando inicia o app desktop via Tauri. Para compilar a interface:

```bash
npm run build
```

## Privacidade

Os arquivos são selecionados localmente pelo usuário e visualizados nesta sessão. O protótipo não envia mídia para um serviço remoto. A tipografia usa fontes do sistema; não é necessário carregar fontes de terceiros pela internet.

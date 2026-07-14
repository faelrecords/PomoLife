# PomoLife

Assistente de IA em português que funciona como chat geral e ativa recursos de produtividade, TDAH, microtarefas, checklists e Pomodoro quando eles forem úteis.

Produção: [pomolife.vibecodex.pro](https://pomolife.vibecodex.pro/)

## Desenvolvimento

Requer Node.js 22 ou superior.

```bash
npm install
npm run dev
```

O Vite serve o projeto em `http://localhost:5173/`.

## Validação

```bash
npm run check
npm run test:e2e
```

## Privacidade e IA local

- Não há backend, conta, chave de API ou analytics.
- O texto das conversas e dos anexos é processado no dispositivo.
- Arquivos de texto, Markdown, CSV, JSON e código podem ser anexados e analisados localmente.
- O seletor oferece modelos locais para diferentes capacidades de memória; cada modelo é baixado somente quando escolhido.
- O modelo fica no cache do navegador e pode ser removido nas configurações.
- Sem WebGPU, o PomoLife continua funcionando no modo básico.
- O player oficial do YouTube recebe dados técnicos quando é carregado, mas nunca recebe o conteúdo do chat.

## Publicação

Todo push na branch `main` executa lint, testes e build antes de publicar `dist` no GitHub Pages. O arquivo `public/CNAME` configura `pomolife.vibecodex.pro`.

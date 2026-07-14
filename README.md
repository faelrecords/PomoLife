# PomoLife

Sete ferramentas de planejamento e foco em português, com inferência local no navegador por meio do WebLLM e um modo básico que funciona sem IA.

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
- Os textos preenchidos são processados no dispositivo.
- A primeira ativação baixa aproximadamente 300 MB de arquivos do modelo.
- O modelo fica no cache do navegador e pode ser removido pelas configurações do site.
- Sem WebGPU, o PomoLife continua funcionando no modo básico local.

## Publicação

Todo push na branch `main` executa lint, testes e build antes de publicar `dist` no GitHub Pages. O arquivo `public/CNAME` configura o domínio `pomolife.vibecodex.pro`.

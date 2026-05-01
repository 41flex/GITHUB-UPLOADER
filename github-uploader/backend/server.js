require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const path = require("path");
const crypto = require("crypto"); // gerar token de segurança
const cookieParser = require("cookie-parser"); // para ler e gravar os cookies
const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);


const app = express();

app.use(cors());
app.use(cookieParser()); //ativa os cookies no servidor

//importante: server.js -> backend, então preciso voltar uma pasta (..) para achar o public
app.use(express.static(path.join(__dirname, "../public")))

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;

// rota de login 
app.get("/login", (req, res) => {
    //gera um state aleatorio
    const state = crypto.randomBytes(16).toString("hex");

    //salva o state no cookie (dura 5 min e front n le)
    res.cookie("oauth_state", state, { maxAge: 1000 * 60 * 5, httpOnly: true, secure: true });

    const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&scope=repo&state=${state}`;
    res.redirect(githubAuthUrl);
});

//rota callback
app.get('/callback', async (req, res) => {
    const { code, state } = req.query; // git devolve o code e o state
    const savedState = req.cookies.oauth_state; //le o state  que salvamos antes

    //seguranca: ver se o state e igual ao salvo, se n for, alguem pode estar tentando roubar o acesso
    //CSRF token prevention

    if (!code || !state || state !== savedState) {
        return res.status(403).send("Erro de seguranca!: Sessão invalida ou tentativa de ataque csrf.");
    }

    try {
        const response = await axios.post(
            'https://github.com/login/oauth/access_token',
            { client_id: GITHUB_CLIENT_ID, client_secret: GITHUB_CLIENT_SECRET, code },
            { headers: { accept: 'application/json' } } //importante, o git devolve JSON
        )

        const accessToken = response.data.access_token;

        // Limpamos o cookie de state, pois já garantimos que o login é seguro
        res.clearCookie('oauth_state');
        // SEGURANÇA 3: Escondemos o Token no Cookie (sai da barra de URL)
        // sameSite: 'strict' garante que outros sites não consigam roubar esse cookie.
        res.cookie('github_token', accessToken, {
            maxAge: 1000 * 60 * 60 * 8, // O token dura 8 horas
            sameSite: 'strict',
            // secure: true // Em produção (quando tiver HTTPS/SSL), você deve descomentar essa linha!
        });
        // Redireciona o usuário para a página inicial limpa
        res.redirect('/');
    } catch (error) {
        console.error(error);
        res.send('Ocorreu um erro ao tentar fazer login com o GitHub.');
    }
});
const PORT = process.env.PORT || 1000;

// --- NOVA ROTA: IA GERANDO README ---
// Precisamos do express.json() para o servidor entender os dados que o Front-end vai mandar
app.post('/generate-readme', express.json(), async (req, res) => {
    try {
        const { filesInfo, repoName } = req.body;

        // O "Comando" (Prompt) que enviamos para a IA:
        const prompt = `Você é um Desenvolvedor Sênior. Escreva um README.md profissional para o repositório chamado '${repoName}'.
Aqui está a lista de arquivos do projeto e alguns trechos de código para você entender exatamente o que esse projeto faz:

${filesInfo}

O README deve conter: 
1. Título e um parágrafo sobre o que o projeto faz.
2. Tecnologias utilizadas (deduza lendo os arquivos e o código).
3. Como instalar/rodar o projeto.
Seja claro e muito profissional! Não adicione comentários dizendo "aqui está o readme", apenas retorne o código Markdown.`;

        // Chama o modelo mais atualizado do Gemini
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const result = await model.generateContent(prompt);

        res.json({ readme: result.response.text() });
    } catch (error) {
        console.error("Erro na IA:", error);
        res.status(500).json({ error: "Falha ao gerar o README" });
    }
});

// --- NOVA ROTA: IA GERANDO REQUIREMENTS.TXT ---
app.post('/generate-requirements', express.json(), async (req, res) => {
    try {
        const { filesInfo } = req.body;

        const prompt = `Você é um programador Python. Analise os códigos abaixo e descubra quais bibliotecas externas estão sendo usadas nos "imports".
Gere APENAS o conteúdo de um arquivo requirements.txt (um pacote por linha, sem formatação markdown). Se o projeto usar apenas bibliotecas nativas do Python, escreva apenas o comentário "# Apenas bibliotecas nativas do Python".
Código do projeto:
${filesInfo}`;

        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const result = await model.generateContent(prompt);

        // Remove blocos de formatação ``` que a IA possa colocar sem querer
        let cleanText = result.response.text().replace(/```[a-z]*\n/g, '').replace(/```/g, '').trim();

        res.json({ requirements: cleanText });
    } catch (error) {
        console.error("Erro na IA:", error);
        res.status(500).json({ error: "Falha ao gerar o requirements" });
    }
});


app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});
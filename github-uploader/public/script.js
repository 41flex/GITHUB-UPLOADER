// --- PARTE 1: VERIFICAÇÃO DE LOGIN ---
function checkLogin() {
    const cookies = document.cookie.split(';');
    const tokenCookie = cookies.find(c => c.trim().startsWith('github_token='));

    if (tokenCookie) {
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('upload-screen').style.display = 'block';
        return tokenCookie.split('=')[1];
    }
    return null;
}

const GITHUB_TOKEN = checkLogin();

// --- PARTE 2: FUNÇÃO PARA LER OS ARQUIVOS DO PC ---
function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const base64Content = reader.result.split(',')[1];
            resolve(base64Content);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// Atualiza o texto avisando quantas pastas/arquivos foram selecionados
document.getElementById('folder-input').addEventListener('change', (event) => {
    const files = event.target.files;
    const fileCountText = document.getElementById('file-count');

    if (files.length > 0) {
        const folderName = files[0].webkitRelativePath.split('/')[0];
        fileCountText.style.color = '#c9d1d9';
        fileCountText.innerText = `📂 Pasta: ${folderName} (${files.length} arquivos prontos para envio)`;
    } else {
        fileCountText.style.color = '#8b949e';
        fileCountText.innerText = "Nenhuma pasta selecionada";
    }
});


// --- PARTE 3: O CORAÇÃO DO SISTEMA (UPLOAD COM GITIGNORE) ---
document.getElementById('btn-upload').addEventListener('click', async () => {
    const files = document.getElementById('folder-input').files;
    const repoName = document.getElementById('repo-name').value.trim().replace(/\s+/g, '-');
    const statusText = document.getElementById('status-message');
    if (files.length === 0) return alert('Selecione uma pasta primeiro!');
    if (!repoName) return alert('Digite um nome para o repositório!');
    statusText.innerText = "⏳ Criando repositório...";
    statusText.style.color = '#8b949e';
    document.getElementById('btn-upload').disabled = true;
    try {
        const userResponse = await fetch('https://api.github.com/user', {
            headers: { 'Authorization': `Bearer ${GITHUB_TOKEN}` }
        });
        if (!userResponse.ok) throw new Error("Token inválido ou expirado. Faça login novamente.");
        const userData = await userResponse.json();
        const username = userData.login;
        const repoResponse = await fetch('https://api.github.com/user/repos', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GITHUB_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name: repoName, private: false })
        });
        if (!repoResponse.ok) {
            const errorData = await repoResponse.json();
            throw new Error(`Erro do GitHub ao criar repositório: ${errorData.message}`);
        }

        // ==========================================
        // 🧠 SISTEMA DE IA PARA README AUTOMÁTICO
        // ==========================================
        const temReadme = Array.from(files).some(f => f.name.toLowerCase() === 'readme.md');

        if (!temReadme) {
            statusText.innerText = "🧠 IA está analisando seus arquivos...";

            // Vamos extrair os nomes dos arquivos e um pedaço do código para a IA entender
            let filesInfo = "ARQUIVOS DO PROJETO:\n";
            let filesRead = 0;
            let filesListed = 0; // Novo contador de segurança 🦺

            for (let f of files) {
                // Bloqueia lixo pesado para não engasgar a IA
                if (f.webkitRelativePath.includes('node_modules') || f.webkitRelativePath.includes('.git') || f.webkitRelativePath.includes('.venv')) continue;

                // Envia NO MÁXIMO os primeiros 50 arquivos para a IA (evita estourar a cota)
                if (filesListed < 50) {
                    filesInfo += `- ${f.webkitRelativePath}\n`;
                    filesListed++;
                }

                // Pega os 3 primeiros arquivos importantes (código) e manda um trecho para a IA ler
                if (filesRead < 3 && (f.name.endsWith('.js') || f.name.endsWith('.html') || f.name.endsWith('.py'))) {
                    const text = await new Promise((resolve) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(reader.result);
                        reader.readAsText(f);
                    });
                    // Pegamos só as primeiras 40 linhas do arquivo para a IA bater o olho e entender
                    const shortText = text.split('\n').slice(0, 40).join('\n');
                    filesInfo += `\nTrecho do código de ${f.name}:\n\`\`\`\n${shortText}\n\`\`\`\n\n`;
                    filesRead++;
                }
            }

            statusText.innerText = "🤖 A IA está escrevendo a documentação...";

            // Pede pro nosso Servidor chamar o Gemini
            const aiResponse = await fetch('/generate-readme', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filesInfo, repoName })
            });

            const aiData = await aiResponse.json();
            const textoReadme = aiData.readme || `# ${repoName}\n\nFalha ao gerar o README com IA.`;

            // NOVA LÓGICA: Pausar e mostrar no Modal
            document.getElementById('readme-preview-text').value = textoReadme;
            document.getElementById('readme-modal').style.display = 'flex';
            statusText.innerText = "👀 Aguardando sua revisão do README...";

            // Criamos uma Promise que só resolve quando o usuário clicar em Salvar ou Pular
            await new Promise((resolve) => {
                // Se clicar em Salvar
                document.getElementById('btn-save-readme').onclick = async () => {
                    document.getElementById('readme-modal').style.display = 'none';
                    const editedReadme = document.getElementById('readme-preview-text').value;
                    statusText.innerText = "⏳ Salvando o README no GitHub...";
                    
                    const base64Readme = btoa(unescape(encodeURIComponent(editedReadme)));

                    await fetch(`https://api.github.com/repos/${username}/${repoName}/contents/README.md`, {
                        method: 'PUT',
                        headers: {
                            'Authorization': `Bearer ${GITHUB_TOKEN}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            message: "Docs: Adicionando README.md revisado 🤖",
                            content: base64Readme
                        })
                    });
                    resolve();
                };

                // Se clicar em Pular/Cancelar
                document.getElementById('btn-cancel-readme').onclick = () => {
                    document.getElementById('readme-modal').style.display = 'none';
                    statusText.innerText = "⏭️ README pulado.";
                    resolve();
                };
            });
        }
            // ==========================================

            // ==========================================
            // 🐍 SISTEMA DE IA PARA REQUIREMENTS.TXT (PYTHON)
            // ==========================================
            const temPython = Array.from(files).some(f => f.name.endsWith('.py'));
            const temRequirements = Array.from(files).some(f => f.name.toLowerCase() === 'requirements.txt');

            if (temPython && !temRequirements) {
                statusText.innerText = "🐍 IA descobrindo dependências do Python...";

                const reqResponse = await fetch('/generate-requirements', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filesInfo }) // Reutiliza a mesma variável de arquivos que a IA do README leu
                });

                const reqData = await reqResponse.json();
                const textoReq = reqData.requirements || "# Erro ao gerar dependências.";

                statusText.innerText = "⏳ Salvando requirements.txt no GitHub...";
                const base64Req = btoa(unescape(encodeURIComponent(textoReq)));

                await fetch(`https://api.github.com/repos/${username}/${repoName}/contents/requirements.txt`, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${GITHUB_TOKEN}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        message: "Build: Adicionando requirements.txt gerado por IA 🤖",
                        content: base64Req
                    })
                });
            }
            // ==========================================


            // ==========================================
            // 🧠 SISTEMA INTELIGENTE DE .GITIGNORE
            // ==========================================
            let ignoredPatterns = ['.git/', 'node_modules/']; // Sempre ignoramos esses por padrão
            // Procura se existe um arquivo chamado ".gitignore" na pasta selecionada
            const gitignoreFile = Array.from(files).find(f => f.name === '.gitignore');
            if (gitignoreFile) {
                statusText.innerText = "🔍 Lendo as regras do .gitignore...";

                // Lê o conteúdo do arquivo como Texto
                const text = await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.readAsText(gitignoreFile);
                });

                // Quebra o texto linha por linha, limpa espaços e tira comentários (#)
                const lines = text.split('\n')
                    .map(line => line.trim())
                    .filter(line => line && !line.startsWith('#'));

                // Adiciona as regras do .gitignore na nossa lista de proibidos
                ignoredPatterns = ignoredPatterns.concat(lines);
                console.log("Regras aplicadas:", ignoredPatterns);
            }
            // Função auxiliar para verificar se o arquivo bate com alguma regra
            function isIgnored(filePath) {
                for (const pattern of ignoredPatterns) {
                    const cleanPattern = pattern.replace(/^\//, ''); // Limpa barras iniciais
                    if (filePath.includes(cleanPattern)) {
                        return true;
                    }
                }
                return false;
            }
            // ==========================================
            // Envia os arquivos
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const filePath = file.webkitRelativePath;

                // 🛡️ USA A NOSSA NOVA FUNÇÃO INTELIGENTE
                if (isIgnored(filePath)) {
                    console.log(`🚫 Arquivo bloqueado pelo .gitignore: ${filePath}`);
                    continue; // Pula para o próximo
                }
                statusText.innerText = `⏳ Enviando: ${filePath} (${i + 1}/${files.length})`;
                const base64Content = await readFileAsBase64(file);
                const fileResponse = await fetch(`https://api.github.com/repos/${username}/${repoName}/contents/${filePath}`, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${GITHUB_TOKEN}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        message: `Adicionando ${filePath}`,
                        content: base64Content
                    })
                });
                if (!fileResponse.ok) {
                    const errorData = await fileResponse.json();
                    throw new Error(`Erro ao enviar ${filePath}: ${errorData.message}`);
                }
            }
            statusText.style.color = '#3fb950';
            statusText.innerText = `✅ Sucesso! Repositório criado no seu GitHub.`;

        } catch (error) {
            console.error(error);
            statusText.style.color = '#f85149';
            statusText.innerText = `❌ ${error.message}`;
        } finally {
            document.getElementById('btn-upload').disabled = false;
        }


    });

// --- CONTROLE DAS ABAS (UI) ---
const tabUpload = document.getElementById('tab-upload');
const tabPR = document.getElementById('tab-pr');
const areaUpload = document.getElementById('area-upload');
const areaPR = document.getElementById('area-pr');

tabUpload.addEventListener('click', () => {
    tabUpload.classList.add('active');
    tabPR.classList.remove('active');
    areaUpload.style.display = 'block';
    areaPR.style.display = 'none';
});

tabPR.addEventListener('click', () => {
    tabPR.classList.add('active');
    tabUpload.classList.remove('active');
    areaPR.style.display = 'block';
    areaUpload.style.display = 'none';
});

// --- SISTEMA DE BUSCAR REPOSITÓRIOS ---
async function carregarRepositorios() {
    if (!GITHUB_TOKEN) return;

    const select = document.getElementById('repo-select');

    try {
        // Pede os seus últimos 100 repositórios atualizados
        const response = await fetch('https://api.github.com/user/repos?sort=updated&per_page=100', {
            headers: { 'Authorization': `Bearer ${GITHUB_TOKEN}` }
        });

        if (!response.ok) throw new Error("Erro ao carregar");

        const repos = await response.json();

        // Limpa aquele texto de "Carregando..."
        select.innerHTML = '<option value="">Selecione um repositório...</option>';

        // Preenche a caixinha com os seus repositórios de verdade!
        repos.forEach(repo => {
            const option = document.createElement('option');
            option.value = repo.name;
            option.textContent = repo.name;
            select.appendChild(option);
        });

        // Acende o botão de PR que estava apagado
        document.getElementById('btn-pr').classList.remove('disabled');

    } catch (error) {
        console.error(error);
        select.innerHTML = '<option value="">Erro ao buscar repositórios ❌</option>';
    }
}

// Se o usuário já estiver logado quando a página abrir, ele já carrega a lista!
if (GITHUB_TOKEN) {
    carregarRepositorios();
}

// ==========================================
// 🚀 BOSS FINAL: LÓGICA DE PULL REQUEST
// ==========================================
document.getElementById('btn-pr').addEventListener('click', async () => {
    const files = document.getElementById('folder-input').files;
    const select = document.getElementById('repo-select');
    const repoName = select.value;
    const branchSelect = document.getElementById('branch-select');
    const targetBranch = branchSelect.value;
    let commitMessage = document.getElementById('commit-message').value.trim();
    const statusText = document.getElementById('status-message');

    // Se o usuário não digitou nada, usamos uma mensagem padrão!
    if (!commitMessage) commitMessage = "Update via GitHub Uploader Pro 🚀";

    if (files.length === 0) return alert('Selecione uma pasta primeiro!');
    if (!repoName) return alert('Selecione um repositório!');
    if (!targetBranch) return alert('Selecione a branch base!');

    // Desativa o botão enquanto processa
    document.getElementById('btn-pr').disabled = true;
    statusText.style.color = 'var(--text-primary)';

    try {
        // 1. Identificar você
        const userRes = await fetch('https://api.github.com/user', { headers: { 'Authorization': `Bearer ${GITHUB_TOKEN}` } });
        const username = (await userRes.json()).login;

        // 2. Sistema de .gitignore embutido
        let ignoredPatterns = ['.git/', 'node_modules/'];
        const gitignoreFile = Array.from(files).find(f => f.name === '.gitignore');
        if (gitignoreFile) {
            const text = await new Promise(resolve => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.readAsText(gitignoreFile);
            });
            const lines = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
            ignoredPatterns = ignoredPatterns.concat(lines);
        }

        const isIgnored = (path) => {
            return ignoredPatterns.some(pattern => {
                const cleanPattern = pattern.replace(/\/$/, '');
                return path.includes(cleanPattern + '/') || path.endsWith(cleanPattern);
            });
        };

        // 3. Pegar informações da Branch que você escolheu!
        statusText.innerHTML = '<span class="spinner"></span> Lendo o repositório original...';
        const refRes = await fetch(`https://api.github.com/repos/${username}/${repoName}/git/refs/heads/${targetBranch}`, { headers: { 'Authorization': `Bearer ${GITHUB_TOKEN}` } });
        const latestCommitSha = (await refRes.json()).object.sha;

        const commitRes = await fetch(`https://api.github.com/repos/${username}/${repoName}/git/commits/${latestCommitSha}`, { headers: { 'Authorization': `Bearer ${GITHUB_TOKEN}` } });
        const baseTreeSha = (await commitRes.json()).tree.sha;

        // 4. Criar uma nova Branch escondida para o seu PR
        const newBranchName = `upload-pr-${Date.now()}`;
        statusText.innerHTML = `<span class="spinner"></span> Criando branch: ${newBranchName}...`;
        await fetch(`https://api.github.com/repos/${username}/${repoName}/git/refs`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ ref: `refs/heads/${newBranchName}`, sha: latestCommitSha })
        });

        // 5. Converter arquivos em "Blobs" (Formato nativo do Git)
        statusText.innerHTML = '<span class="spinner"></span> Empacotando arquivos de forma invisível...';
        const treeArray = [];
        for (let f of files) {
            const filePath = f.webkitRelativePath.substring(f.webkitRelativePath.indexOf('/') + 1);
            if (isIgnored(filePath) || !filePath) continue; // Ignora lixo

            const base64Content = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result.split(',')[1]);
                reader.readAsDataURL(f);
            });

            const blobRes = await fetch(`https://api.github.com/repos/${username}/${repoName}/git/blobs`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: base64Content, encoding: 'base64' })
            });
            const blobSha = (await blobRes.json()).sha;

            treeArray.push({
                path: filePath,
                mode: "100644",
                type: "blob",
                sha: blobSha
            });
        }

        // 6. Criar a Árvore de Arquivos
        statusText.innerHTML = '<span class="spinner"></span> Montando a estrutura do Commit...';
        const newTreeRes = await fetch(`https://api.github.com/repos/${username}/${repoName}/git/trees`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ base_tree: baseTreeSha, tree: treeArray })
        });
        const newTreeSha = (await newTreeRes.json()).sha;

        // 7. Fazer o Commit Oficial (com a sua Mensagem Personalizada!)
        statusText.innerHTML = '<span class="spinner"></span> Registrando Commit...';
        const newCommitRes = await fetch(`https://api.github.com/repos/${username}/${repoName}/git/commits`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: commitMessage, tree: newTreeSha, parents: [latestCommitSha] })
        });
        const newCommitSha = (await newCommitRes.json()).sha;

        // 8. Atualizar a Branch com tudo empacotado
        await fetch(`https://api.github.com/repos/${username}/${repoName}/git/refs/heads/${newBranchName}`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ sha: newCommitSha })
        });

        // 9. ZERAR O JOGO: ABRIR O PULL REQUEST!
        statusText.innerHTML = '<span class="spinner"></span> Abrindo o Pull Request...';
        const prRes = await fetch(`https://api.github.com/repos/${username}/${repoName}/pulls`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: commitMessage,
                body: `Esse Pull Request foi gerado automaticamente pelo **GitHub Uploader Pro**.\n\n**Commit:** ${commitMessage}\nPor favor, revise o código antes de dar Merge.`,
                head: newBranchName,
                base: targetBranch // Vai mirar na Branch que você escolheu!
            })
        });

        const prData = await prRes.json();

        statusText.style.color = 'var(--ios-green)';
        statusText.innerHTML = `✅ PR Aberto com Sucesso! <br><br> <a href="${prData.html_url}" target="_blank" style="color:var(--ios-blue); font-weight:bold; text-decoration: none; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 8px;">🔗 Clique aqui para ver e aprovar no GitHub</a>`;

    } catch (error) {
        console.error(error);
        statusText.style.color = '#ff453a'; // Vermelho de erro do iOS
        statusText.innerText = `❌ Erro: ${error.message}`;
    } finally {
        document.getElementById('btn-pr').disabled = false;
    }
});

// ==========================================
// 🚀 EVENTOS DAS NOVAS FUNÇÕES (Logout e Branches)
// ==========================================

// 1. Lógica do Botão Sair
document.getElementById('btn-logout').addEventListener('click', () => {
    // Apaga os cookies e reinicia
    document.cookie = "github_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    window.location.reload();
});

// Mostra o botão de logout somente se estiver logado
if (typeof GITHUB_TOKEN !== 'undefined' && GITHUB_TOKEN) {
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) btnLogout.style.display = 'inline-block';
}

// 2. Lógica para carregar as Branches quando você escolhe um Repositório
document.getElementById('repo-select').addEventListener('change', async (e) => {
    const repoName = e.target.value;
    const branchSelect = document.getElementById('branch-select');

    // Se não tiver repositório selecionado, esconde a lista de branch
    if (!repoName) {
        branchSelect.style.display = 'none';
        return;
    }

    branchSelect.style.display = 'block';
    branchSelect.innerHTML = '<option value="">Carregando branches...</option>';

    try {
        const userRes = await fetch('https://api.github.com/user', { headers: { 'Authorization': `Bearer ${GITHUB_TOKEN}` } });
        const username = (await userRes.json()).login;

        const res = await fetch(`https://api.github.com/repos/${username}/${repoName}/branches`, { headers: { 'Authorization': `Bearer ${GITHUB_TOKEN}` } });
        const branches = await res.json();

        // Coloca as branches na tela
        branchSelect.innerHTML = '<option value="">Selecione a Branch Base</option>';
        branches.forEach(b => {
            const opt = document.createElement('option');
            opt.value = b.name;
            opt.textContent = b.name;
            branchSelect.appendChild(opt);
        });
    } catch (err) {
        branchSelect.innerHTML = '<option value="">Erro ao carregar</option>';
    }
});

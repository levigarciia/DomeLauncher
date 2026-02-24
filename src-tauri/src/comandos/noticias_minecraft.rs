use futures::{stream, StreamExt};
use serde::{Deserialize, Serialize};

const MINECRAFT_SITEMAP_URL: &str = "https://www.minecraft.net/sitemap.xml";
const MINECRAFT_SITE_BASE_URL: &str = "https://www.minecraft.net";
const CACHE_NOTICIAS_TTL_MS: u64 = 30 * 60 * 1000;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NoticiaMinecraft {
    pub titulo: String,
    pub descricao: String,
    pub url: String,
    pub imagem_url: Option<String>,
    pub publicado_em: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct CacheNoticiasMinecraft {
    pub gerado_em_ms: u64,
    pub itens: Vec<NoticiaMinecraft>,
}

fn agora_em_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duracao| duracao.as_millis() as u64)
        .unwrap_or(0)
}

fn get_cache_dir() -> std::path::PathBuf {
    std::env::var("APPDATA")
        .map(|app_data| std::path::PathBuf::from(app_data).join("dome").join("cache"))
        .unwrap_or_else(|_| std::path::PathBuf::from("cache"))
}

fn get_minecraft_news_cache_path() -> std::path::PathBuf {
    get_cache_dir().join("minecraft-news-v2.json")
}

fn ler_cache_noticias_minecraft(limite: usize) -> Option<Vec<NoticiaMinecraft>> {
    let caminho = get_minecraft_news_cache_path();
    let conteudo = std::fs::read_to_string(caminho).ok()?;
    let cache = serde_json::from_str::<CacheNoticiasMinecraft>(&conteudo).ok()?;
    let idade = agora_em_ms().saturating_sub(cache.gerado_em_ms);

    if idade > CACHE_NOTICIAS_TTL_MS {
        return None;
    }

    if cache.itens.is_empty() {
        return None;
    }

    Some(cache.itens.into_iter().take(limite).collect())
}

fn salvar_cache_noticias_minecraft(itens: &[NoticiaMinecraft]) {
    if itens.is_empty() {
        return;
    }

    let caminho = get_minecraft_news_cache_path();
    if let Some(pasta) = caminho.parent() {
        let _ = std::fs::create_dir_all(pasta);
    }

    let cache = CacheNoticiasMinecraft {
        gerado_em_ms: agora_em_ms(),
        itens: itens.to_vec(),
    };

    if let Ok(conteudo) = serde_json::to_string(&cache) {
        let _ = std::fs::write(caminho, conteudo);
    }
}

fn decodificar_entidades(texto: &str) -> String {
    texto
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

fn limpar_texto_html(texto: &str) -> String {
    decodificar_entidades(texto)
        .replace('\n', " ")
        .replace('\r', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn extrair_tag_xml(bloco: &str, tag: &str) -> Option<String> {
    let inicio_tag = format!("<{}>", tag);
    let fim_tag = format!("</{}>", tag);

    let inicio = bloco.find(&inicio_tag)? + inicio_tag.len();
    let resto = &bloco[inicio..];
    let fim_rel = resto.find(&fim_tag)?;
    let valor = resto[..fim_rel].trim();

    if valor.is_empty() {
        None
    } else {
        Some(decodificar_entidades(valor))
    }
}

fn extrair_atributo_html(tag: &str, nome: &str) -> Option<String> {
    let padrao_aspas_duplas = format!(r#"{}=""#, nome);
    if let Some(inicio_idx) = tag.find(&padrao_aspas_duplas) {
        let inicio_valor = inicio_idx + padrao_aspas_duplas.len();
        let restante = &tag[inicio_valor..];
        let fim = restante.find('"')?;
        let valor = restante[..fim].trim();
        if !valor.is_empty() {
            return Some(decodificar_entidades(valor));
        }
    }

    let padrao_aspas_simples = format!("{}='", nome);
    if let Some(inicio_idx) = tag.find(&padrao_aspas_simples) {
        let inicio_valor = inicio_idx + padrao_aspas_simples.len();
        let restante = &tag[inicio_valor..];
        let fim = restante.find('\'')?;
        let valor = restante[..fim].trim();
        if !valor.is_empty() {
            return Some(decodificar_entidades(valor));
        }
    }

    None
}

fn extrair_meta_content(html: &str, atributo: &str, valor: &str) -> Option<String> {
    let marcador_aspas_duplas = format!(r#"{}="{}""#, atributo, valor);
    let marcador_aspas_simples = format!("{}='{}'", atributo, valor);

    for trecho in html.split("<meta").skip(1) {
        let tag = match trecho.split('>').next() {
            Some(valor_tag) => valor_tag,
            None => continue,
        };

        if !tag.contains(&marcador_aspas_duplas) && !tag.contains(&marcador_aspas_simples) {
            continue;
        }

        if let Some(conteudo) = extrair_atributo_html(tag, "content") {
            let limpo = limpar_texto_html(&conteudo);
            if !limpo.is_empty() {
                return Some(limpo);
            }
        }
    }

    None
}

fn extrair_primeiro_meta(html: &str, seletores: &[(&str, &str)]) -> Option<String> {
    for (atributo, valor) in seletores {
        if let Some(conteudo) = extrair_meta_content(html, atributo, valor) {
            if !conteudo.trim().is_empty() {
                return Some(conteudo);
            }
        }
    }
    None
}

fn extrair_titulo_html(html: &str) -> Option<String> {
    let inicio = html.find("<title>")? + "<title>".len();
    let restante = &html[inicio..];
    let fim = restante.find("</title>")?;
    let titulo_bruto = restante[..fim].trim();
    if titulo_bruto.is_empty() {
        return None;
    }

    let titulo_limpo = limpar_texto_html(titulo_bruto)
        .replace(" | Minecraft", "")
        .trim()
        .to_string();
    if titulo_limpo.is_empty() {
        None
    } else {
        Some(titulo_limpo)
    }
}

fn titulo_da_url_artigo(url: &str) -> String {
    let slug = url
        .split("/article/")
        .nth(1)
        .unwrap_or(url)
        .split('?')
        .next()
        .unwrap_or(url)
        .trim_matches('/');

    if slug.is_empty() {
        return "Notícia do Minecraft".to_string();
    }

    slug.split('-')
        .filter(|parte| !parte.trim().is_empty())
        .map(|parte| {
            let mut caracteres = parte.chars();
            match caracteres.next() {
                Some(inicial) => {
                    format!("{}{}", inicial.to_uppercase(), caracteres.as_str())
                }
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn normalizar_url_minecraft(url: &str) -> String {
    let valor = url.trim();
    if valor.starts_with("https://") || valor.starts_with("http://") {
        return valor.to_string();
    }
    if valor.starts_with("//") {
        return format!("https:{}", valor);
    }
    if valor.starts_with('/') {
        return format!("{}{}", MINECRAFT_SITE_BASE_URL, valor);
    }
    format!("{}/{}", MINECRAFT_SITE_BASE_URL, valor)
}

async fn montar_noticia_minecraft(
    client: &reqwest::Client,
    url: String,
    publicado_em_sitemap: String,
) -> NoticiaMinecraft {
    let mut titulo = titulo_da_url_artigo(&url);
    let mut descricao = String::new();
    let mut imagem_url: Option<String> = None;
    let mut publicado_em = publicado_em_sitemap;

    if let Ok(resposta) = client
        .get(&url)
        .header("User-Agent", "DomeLauncher/1.0 (+https://domestudios.com.br)")
        .header("Accept-Language", "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7")
        .send()
        .await
    {
        if resposta.status().is_success() {
            if let Ok(html) = resposta.text().await {
                if let Some(titulo_og) = extrair_primeiro_meta(
                    &html,
                    &[("property", "og:title"), ("name", "twitter:title")],
                ) {
                    titulo = titulo_og;
                } else if let Some(titulo_tag) = extrair_titulo_html(&html) {
                    titulo = titulo_tag;
                }

                if let Some(descricao_og) = extrair_primeiro_meta(
                    &html,
                    &[
                        ("property", "og:description"),
                        ("name", "description"),
                        ("name", "twitter:description"),
                    ],
                ) {
                    descricao = descricao_og;
                }

                if let Some(imagem) = extrair_primeiro_meta(
                    &html,
                    &[("property", "og:image"), ("name", "twitter:image")],
                ) {
                    let url_imagem = normalizar_url_minecraft(&imagem);
                    imagem_url = Some(url_imagem);
                }

                if let Some(data_publicada) = extrair_primeiro_meta(
                    &html,
                    &[("property", "article:published_time"), ("name", "date")],
                ) {
                    publicado_em = data_publicada;
                }
            }
        }
    }

    NoticiaMinecraft {
        titulo,
        descricao,
        url,
        imagem_url,
        publicado_em,
    }
}

async fn baixar_sitemap_minecraft(client: &reqwest::Client) -> Result<String, String> {
    let urls = [
        MINECRAFT_SITEMAP_URL,
        "https://www.minecraft.net/en-us/sitemap.xml",
    ];
    let mut erros: Vec<String> = Vec::new();

    for url in urls {
        match client.get(url).send().await {
            Ok(resposta) => {
                if !resposta.status().is_success() {
                    erros.push(format!("{} retornou HTTP {}", url, resposta.status().as_u16()));
                    continue;
                }

                match resposta.text().await {
                    Ok(conteudo) => return Ok(conteudo),
                    Err(erro) => {
                        erros.push(format!("{} falhou ao ler body: {}", url, erro));
                        continue;
                    }
                }
            }
            Err(erro) => {
                erros.push(format!("{} falhou: {}", url, erro));
                continue;
            }
        }
    }

    Err(format!(
        "Erro ao buscar sitemap do Minecraft: {}",
        erros.join(" | ")
    ))
}

#[tauri::command]
pub async fn get_minecraft_news(limit: Option<u32>) -> Result<Vec<NoticiaMinecraft>, String> {
    let limite = limit.unwrap_or(5).clamp(1, 10) as usize;

    if let Some(cache) = ler_cache_noticias_minecraft(limite) {
        return Ok(cache);
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .user_agent("DomeLauncher/1.0 (+https://domestudios.com.br)")
        .build()
        .map_err(|e| format!("Erro ao criar cliente HTTP: {}", e))?;

    let sitemap = baixar_sitemap_minecraft(&client).await?;

    let mut artigos: Vec<(String, String)> = Vec::new();

    for trecho in sitemap.split("<url>").skip(1) {
        let bloco = match trecho.split("</url>").next() {
            Some(valor_bloco) => valor_bloco,
            None => continue,
        };

        let loc = match extrair_tag_xml(bloco, "loc") {
            Some(valor) => valor,
            None => continue,
        };

        if !loc.contains("/article/") {
            continue;
        }

        let lastmod = extrair_tag_xml(bloco, "lastmod").unwrap_or_default();
        if lastmod.is_empty() {
            continue;
        }

        artigos.push((loc, lastmod));
    }

    if artigos.is_empty() {
        return Err("Nenhuma notícia encontrada no sitemap do Minecraft.".to_string());
    }

    artigos.sort_by(|a, b| b.1.cmp(&a.1));
    let candidatos: Vec<(String, String)> = artigos.into_iter().take(limite * 3).collect();

    let mut noticias: Vec<NoticiaMinecraft> = stream::iter(candidatos.into_iter())
        .map(|(url, data)| {
            let client = client.clone();
            async move { montar_noticia_minecraft(&client, url, data).await }
        })
        .buffer_unordered(6)
        .collect()
        .await;

    noticias.sort_by(|a, b| b.publicado_em.cmp(&a.publicado_em));
    noticias.truncate(limite);

    if noticias.is_empty() {
        return Err("Nenhuma notícia pôde ser carregada no momento.".to_string());
    }

    salvar_cache_noticias_minecraft(&noticias);

    Ok(noticias)
}

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use encoding_rs::{GBK, WINDOWS_1252};
use regex::Regex;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use walkdir::WalkDir;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Rule {
    #[serde(rename = "format", default)]
    _format: Option<String>,
    #[serde(default)]
    include_keys: Option<Vec<String>>,
    #[serde(default)]
    exclude_keys: Option<Vec<String>>,
    #[serde(default)]
    include_key_regex: Option<String>,
    #[serde(default)]
    exclude_key_regex: Option<String>,
    #[serde(default)]
    include_path_regex: Option<String>,
    #[serde(default)]
    exclude_path_regex: Option<String>,
    #[serde(default)]
    skip_empty: Option<bool>,
    #[serde(default)]
    regex: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Segment {
    id: String,
    file: String,
    path: Vec<String>,
    source: String,
    placeholders: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
struct ScanError {
    file: String,
    message: String,
}

#[derive(Debug, Clone, Serialize)]
struct ScanResult {
    segments: Vec<Segment>,
    errors: Vec<ScanError>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiConfig {
    api_key: String,
    base_url: String,
    model: String,
    system_prompt: String,
    user_prompt_prefix: String,
    provider: String,
    #[serde(default)]
    timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TranslationResult {
    id: String,
    target: String,
    valid: bool,
}

#[derive(Debug)]
struct ScannedFile {
    path: String,
    content: String,
    kind: String,
}

fn read_text_file_with_fallback(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("读取文件失败: {}", e))?;
    if let Ok(text) = String::from_utf8(bytes.clone()) {
        return Ok(text);
    }
    let (gbk_text, gbk_err) = GBK.decode_without_bom_handling(&bytes);
    if !gbk_err {
        return Ok(gbk_text.into_owned());
    }
    let (cp_text, cp_err) = WINDOWS_1252.decode_without_bom_handling(&bytes);
    if !cp_err {
        return Ok(cp_text.into_owned());
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

fn decode_command_output(bytes: &[u8]) -> String {
    if let Ok(text) = String::from_utf8(bytes.to_vec()) {
        return text;
    }
    let (gbk_text, gbk_err) = GBK.decode_without_bom_handling(bytes);
    if !gbk_err {
        return gbk_text.into_owned();
    }
    let (cp_text, cp_err) = WINDOWS_1252.decode_without_bom_handling(bytes);
    if !cp_err {
        return cp_text.into_owned();
    }
    String::from_utf8_lossy(bytes).into_owned()
}

fn scan_files(dir: &str) -> Result<(Vec<ScannedFile>, Vec<ScanError>), String> {
    let root = Path::new(dir);
    if !root.exists() {
        return Err(format!("目录不存在: {}", root.display()));
    }
    if !root.is_dir() {
        return Err(format!("路径不是目录: {}", root.display()));
    }
    let mut out = Vec::new();
    let mut errors = Vec::new();
    for entry in WalkDir::new(dir).into_iter().filter_map(Result::ok) {
        if !entry.file_type().is_file() {
            continue;
        }
        let p = entry.path();
        let ext = p
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !matches!(ext.as_str(), "json" | "txt" | "cfg" | "ini" | "lang" | "yml" | "yaml") {
            continue;
        }
        match read_text_file_with_fallback(p) {
            Ok(content) => {
                out.push(ScannedFile {
                    path: p.to_string_lossy().to_string(),
                    content,
                    kind: if ext == "json" { "json".into() } else { "text".into() },
                });
            }
            Err(e) => {
                errors.push(ScanError {
                    file: p.to_string_lossy().to_string(),
                    message: format!("读取文件失败: {}", e),
                });
            }
        }
    }
    Ok((out, errors))
}

fn extract_name_without_str_pl(name_value: &Value) -> Option<String> {
    match name_value {
        Value::String(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        Value::Object(map) => {
            if map.get("str_pl").and_then(Value::as_str).is_some() {
                return None;
            }
            let singular = map
                .get("str")
                .and_then(Value::as_str)
                .or_else(|| map.get("str_sp").and_then(Value::as_str))?;
            let trimmed = singular.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        _ => None,
    }

}

fn collect_names_without_str_pl_from_value(value: &Value) -> HashSet<String> {
    let mut out = HashSet::new();

    fn walk(value: &Value, out: &mut HashSet<String>) {
        match value {
            Value::Array(items) => {
                for item in items {
                    walk(item, out);
                }
            }
            Value::Object(map) => {
                if let Some(name_value) = map.get("name") {
                    if let Some(name) = extract_name_without_str_pl(name_value) {
                        out.insert(name);
                    }
                }
                for nested in map.values() {
                    walk(nested, out);
                }
            }
            _ => {}
        }
    }

    walk(value, &mut out);
    out
}

fn collect_plural_override_names_without_str_pl(mod_dir: &str) -> Result<HashSet<String>, String> {
    let mut out = HashSet::new();
    for entry in WalkDir::new(mod_dir).into_iter().filter_map(Result::ok) {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let ext = path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if ext != "json" {
            continue;
        }
        let content = read_text_file_with_fallback(path)?;
        let parsed: Value = match serde_json::from_str(&content) {
            Ok(value) => value,
            Err(_) => continue,
        };
        out.extend(collect_names_without_str_pl_from_value(&parsed));
    }
    Ok(out)
}

fn unescape_po_quoted(input: &str) -> String {
    let mut out = String::new();
    let mut chars = input.chars();
    while let Some(ch) = chars.next() {
        if ch != '\\' {
            out.push(ch);
            continue;
        }
        match chars.next() {
            Some('n') => out.push('\n'),
            Some('r') => out.push('\r'),
            Some('t') => out.push('\t'),
            Some('"') => out.push('"'),
            Some('\\') => out.push('\\'),
            Some(other) => {
                out.push('\\');
                out.push(other);
            }
            None => out.push('\\'),
        }
    }
    out
}

fn escape_po_quoted(input: &str) -> String {
    input
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\t', "\\t")
}

fn parse_po_inline_string(line: &str, key: &str) -> Option<String> {
    let trimmed = line.trim_start();
    let rest = trimmed.strip_prefix(key)?.trim_start();
    let inner = rest.strip_prefix('"')?.strip_suffix('"')?;
    Some(unescape_po_quoted(inner))
}

fn replace_po_inline_string(line: &str, key: &str, value: &str) -> String {
    let indent_len = line.len() - line.trim_start().len();
    let indent = &line[..indent_len];
    format!(r#"{indent}{key}"{}""#, escape_po_quoted(value))
}

fn apply_plural_override_to_pot_text(content: &str, candidates: &HashSet<String>) -> String {
    if candidates.is_empty() {
        return content.to_string();
    }

    let trailing_newline = content.ends_with('\n');
    let mut lines = content.lines().map(str::to_string).collect::<Vec<_>>();
    let mut start = 0usize;

    while start < lines.len() {
        let mut end = start;
        while end < lines.len() && !lines[end].trim().is_empty() {
            end += 1;
        }

        let mut msgid: Option<String> = None;
        let mut msgid_plural_index: Option<usize> = None;
        let mut msgid_plural: Option<String> = None;

        for idx in start..end {
            if msgid.is_none() {
                msgid = parse_po_inline_string(&lines[idx], "msgid ");
            }
            if msgid_plural.is_none() {
                if let Some(value) = parse_po_inline_string(&lines[idx], "msgid_plural ") {
                    msgid_plural_index = Some(idx);
                    msgid_plural = Some(value);
                }
            }
        }

        if let (Some(msgid_value), Some(msgid_plural_value), Some(index)) =
            (msgid, msgid_plural, msgid_plural_index)
        {
            if candidates.contains(&msgid_value) && msgid_plural_value == format!("{msgid_value}s") {
                lines[index] = replace_po_inline_string(&lines[index], "msgid_plural ", &msgid_value);
            }
        }

        start = end + 1;
    }

    let mut result = lines.join("\n");
    if trailing_newline {
        result.push('\n');
    }
    result
}

fn post_process_generated_pot_plural_override(
    config: &LangWorkflowConfig,
    pot_file: &Path,
) -> Result<(), String> {
    if !config.no_str_pl_no_s {
        return Ok(());
    }
    let candidates = collect_plural_override_names_without_str_pl(&config.mod_dir)?;
    if candidates.is_empty() {
        return Ok(());
    }
    let content = read_text_file_with_fallback(pot_file)?;
    let rewritten = apply_plural_override_to_pot_text(&content, &candidates);
    if rewritten != content {
        fs::write(pot_file, rewritten)
            .map_err(|e| format!("写回 POT 失败 {}: {}", pot_file.display(), e))?;
    }
    Ok(())
}

fn validate_json_files_for_pot(mod_dir: &str) -> Result<(), String> {
    let mut errors: Vec<String> = Vec::new();
    for entry in WalkDir::new(mod_dir).into_iter().filter_map(Result::ok) {
        if !entry.file_type().is_file() {
            continue;
        }
        let p = entry.path();
        let ext = p
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if ext != "json" {
            continue;
        }
        let content = match read_text_file_with_fallback(p) {
            Ok(v) => v,
            Err(e) => {
                errors.push(format!("{}: {}", p.display(), e));
                if errors.len() >= 20 {
                    break;
                }
                continue;
            }
        };
        if let Err(e) = serde_json::from_str::<Value>(&content) {
            errors.push(format!(
                "{}: JSON 无效 (line {}, column {}): {}",
                p.display(),
                e.line(),
                e.column(),
                e
            ));
            if errors.len() >= 20 {
                break;
            }
        }
    }
    if errors.is_empty() {
        return Ok(());
    }
    Err(format!(
        "检测到 {} 个非法 JSON 文件，POT 提取已中止。\n{}",
        errors.len(),
        errors.join("\n")
    ))
}

fn detect_placeholders(s: &str) -> Vec<String> {
    let patterns = [
        Regex::new(r"\{\w[^}]*\}").expect("regex"),
        Regex::new(r"\$\{\w[^}]*\}").expect("regex"),
        Regex::new(r"%[sd]").expect("regex"),
        Regex::new(r"<[^>]+>").expect("regex"),
    ];
    let mut set = HashSet::new();
    for p in patterns.iter() {
        for m in p.find_iter(s) {
            set.insert(m.as_str().to_string());
        }
    }
    set.into_iter().collect()
}

fn push_segment(segs: &mut Vec<Segment>, rule: &Rule, file_path: &str, path: Vec<String>, value: &str, include_path_re: &Option<Regex>, exclude_path_re: &Option<Regex>) {
    let skip_empty = rule.skip_empty.unwrap_or(false);
    if skip_empty && value.trim().is_empty() {
        return;
    }
    let path_str = path.join(".");
    if let Some(re) = exclude_path_re {
        if re.is_match(&path_str) {
            return;
        }
    }
    if let Some(re) = include_path_re {
        if !re.is_match(&path_str) {
            return;
        }
    }
    segs.push(Segment {
        id: format!("{}:{}", file_path, path_str),
        file: file_path.to_string(),
        path,
        source: value.to_string(),
        placeholders: detect_placeholders(value),
    });
}

fn extract_from_json(content: &str, file_path: &str, rule: &Rule) -> Result<Vec<Segment>, String> {
    let root: Value = serde_json::from_str(content).map_err(|e| format!("JSON 解析失败: {}", e))?;
    let mut segs = Vec::new();
    let include_key_re = rule
        .include_key_regex
        .as_ref()
        .map(|s| Regex::new(s).map_err(|e| format!("includeKeyRegex 无效: {}", e)))
        .transpose()?;
    let exclude_key_re = rule
        .exclude_key_regex
        .as_ref()
        .map(|s| Regex::new(s).map_err(|e| format!("excludeKeyRegex 无效: {}", e)))
        .transpose()?;
    let include_path_re = rule
        .include_path_regex
        .as_ref()
        .map(|s| Regex::new(s).map_err(|e| format!("includePathRegex 无效: {}", e)))
        .transpose()?;
    let exclude_path_re = rule
        .exclude_path_regex
        .as_ref()
        .map(|s| Regex::new(s).map_err(|e| format!("excludePathRegex 无效: {}", e)))
        .transpose()?;
    let include_keys = rule.include_keys.clone().unwrap_or_default();
    let exclude_keys = rule.exclude_keys.clone().unwrap_or_default();
    let name_fields: HashSet<&str> = ["str", "str_sp", "str_pl"].into_iter().collect();

    fn should_include_key(
        key: &str,
        include_keys: &[String],
        exclude_keys: &[String],
        include_key_re: &Option<Regex>,
        exclude_key_re: &Option<Regex>,
    ) -> bool {
        if exclude_keys.iter().any(|k| k == key) {
            return false;
        }
        if let Some(re) = exclude_key_re {
            if re.is_match(key) {
                return false;
            }
        }
        let has_include = !include_keys.is_empty() || include_key_re.is_some();
        if !has_include {
            return true;
        }
        if include_keys.iter().any(|k| k == key) {
            return true;
        }
        if let Some(re) = include_key_re {
            return re.is_match(key);
        }
        false
    }

    fn walk(
        value: &Value,
        path: Vec<String>,
        segs: &mut Vec<Segment>,
        rule: &Rule,
        file_path: &str,
        include_keys: &[String],
        exclude_keys: &[String],
        include_key_re: &Option<Regex>,
        exclude_key_re: &Option<Regex>,
        include_path_re: &Option<Regex>,
        exclude_path_re: &Option<Regex>,
        name_fields: &HashSet<&str>,
    ) {
        if let Value::Object(map) = value {
            for (k, v) in map.iter() {
                let mut p = path.clone();
                p.push(k.clone());
                if should_include_key(k, include_keys, exclude_keys, include_key_re, exclude_key_re) {
                    match v {
                        Value::String(s) => {
                            push_segment(segs, rule, file_path, p.clone(), s, include_path_re, exclude_path_re);
                        }
                        Value::Array(arr) => {
                            for (idx, item) in arr.iter().enumerate() {
                                match item {
                                    Value::String(s) => {
                                        let mut pp = p.clone();
                                        pp.push(idx.to_string());
                                        push_segment(segs, rule, file_path, pp, s, include_path_re, exclude_path_re);
                                    }
                                    Value::Object(obj) => {
                                        for (nk, nv) in obj.iter() {
                                            if !name_fields.contains(nk.as_str()) {
                                                continue;
                                            }
                                            if let Value::String(s) = nv {
                                                let mut pp = p.clone();
                                                pp.push(idx.to_string());
                                                pp.push(nk.clone());
                                                push_segment(segs, rule, file_path, pp, s, include_path_re, exclude_path_re);
                                            }
                                        }
                                    }
                                    _ => {}
                                }
                            }
                        }
                        Value::Object(obj) => {
                            for (nk, nv) in obj.iter() {
                                if !name_fields.contains(nk.as_str()) {
                                    continue;
                                }
                                if let Value::String(s) = nv {
                                    let mut pp = p.clone();
                                    pp.push(nk.clone());
                                    push_segment(segs, rule, file_path, pp, s, include_path_re, exclude_path_re);
                                }
                            }
                        }
                        _ => {}
                    }
                }
                walk(
                    v,
                    p,
                    segs,
                    rule,
                    file_path,
                    include_keys,
                    exclude_keys,
                    include_key_re,
                    exclude_key_re,
                    include_path_re,
                    exclude_path_re,
                    name_fields,
                );
            }
        } else if let Value::Array(arr) = value {
            for (idx, item) in arr.iter().enumerate() {
                let mut p = path.clone();
                p.push(idx.to_string());
                walk(
                    item,
                    p,
                    segs,
                    rule,
                    file_path,
                    include_keys,
                    exclude_keys,
                    include_key_re,
                    exclude_key_re,
                    include_path_re,
                    exclude_path_re,
                    name_fields,
                );
            }
        }
    }

    walk(
        &root,
        vec![],
        &mut segs,
        rule,
        file_path,
        &include_keys,
        &exclude_keys,
        &include_key_re,
        &exclude_key_re,
        &include_path_re,
        &exclude_path_re,
        &name_fields,
    );
    Ok(segs)
}

fn extract_from_text(content: &str, file_path: &str, rule: &Rule) -> Result<Vec<Segment>, String> {
    let regex = if let Some(s) = &rule.regex {
        Regex::new(s).map_err(|e| format!("文本正则无效: {}", e))?
    } else {
        Regex::new(r"[^\r\n]+").map_err(|e| e.to_string())?
    };
    let skip_empty = rule.skip_empty.unwrap_or(false);
    let mut segs = Vec::new();
    for (i, m) in regex.find_iter(content).enumerate() {
        let s = m.as_str();
        if skip_empty && s.trim().is_empty() {
            continue;
        }
        segs.push(Segment {
            id: format!("{}:content.{}", file_path, i),
            file: file_path.to_string(),
            path: vec!["content".to_string(), i.to_string()],
            source: s.to_string(),
            placeholders: detect_placeholders(s),
        });
    }
    Ok(segs)
}

fn write_back_json(content: &str, translations: &HashMap<String, String>, file_path: &str) -> Result<String, String> {
    let mut root: Value = serde_json::from_str(content).map_err(|e| format!("JSON 解析失败: {}", e))?;
    fn apply(value: &mut Value, path: &mut Vec<String>, translations: &HashMap<String, String>, file_path: &str) {
        match value {
            Value::Array(arr) => {
                for (i, item) in arr.iter_mut().enumerate() {
                    path.push(i.to_string());
                    apply(item, path, translations, file_path);
                    path.pop();
                }
            }
            Value::Object(map) => {
                let keys: Vec<String> = map.keys().cloned().collect();
                for k in keys {
                    if let Some(v) = map.get_mut(&k) {
                        path.push(k.clone());
                        let id = format!("{}:{}", file_path, path.join("."));
                        if let Value::String(s) = v {
                            if let Some(t) = translations.get(&id) {
                                *s = t.clone();
                            }
                        } else {
                            apply(v, path, translations, file_path);
                        }
                        path.pop();
                    }
                }
            }
            _ => {}
        }
    }
    let mut p = vec![];
    apply(&mut root, &mut p, translations, file_path);
    serde_json::to_string_pretty(&root).map_err(|e| e.to_string())
}

fn write_back_text(content: &str, translations: &HashMap<String, String>, file_path: &str, regex_source: &Option<String>) -> Result<String, String> {
    let regex = if let Some(s) = regex_source {
        Regex::new(s).map_err(|e| format!("文本正则无效: {}", e))?
    } else {
        Regex::new(r"[^\r\n]+").map_err(|e| e.to_string())?
    };
    let mut out = String::new();
    let mut last_index = 0;
    for (i, m) in regex.find_iter(content).enumerate() {
        out.push_str(&content[last_index..m.start()]);
        let id = format!("{}:content.{}", file_path, i);
        if let Some(t) = translations.get(&id) {
            out.push_str(t);
        } else {
            out.push_str(m.as_str());
        }
        last_index = m.end();
    }
    out.push_str(&content[last_index..]);
    Ok(out)
}

fn strip_code_block(s: &str) -> String {
    let re = Regex::new(r"(?s)```(?:json)?\s*(.*?)\s*```").expect("regex");
    if let Some(c) = re.captures(s) {
        return c.get(1).map(|m| m.as_str().to_string()).unwrap_or_else(|| s.to_string());
    }
    s.to_string()
}

fn parse_translation_response(content: &str, original_segments: &[Segment]) -> Result<Vec<TranslationResult>, String> {
    let mut json_str = strip_code_block(content).trim().to_string();
    if let (Some(start), Some(end)) = (json_str.find('['), json_str.rfind(']')) {
        if start <= end {
            json_str = json_str[start..=end].to_string();
        }
    }
    let parsed: Value = serde_json::from_str(&json_str)
        .or_else(|_| serde_json::from_str(content))
        .map_err(|e| format!("解析返回 JSON 失败: {}", e))?;
    let items = if parsed.is_array() {
        parsed.as_array().cloned().unwrap_or_default()
    } else if parsed.is_object() {
        let obj = parsed.as_object().expect("object");
        let mut found: Vec<Value> = vec![];
        for v in obj.values() {
            if let Some(arr) = v.as_array() {
                found = arr.clone();
                break;
            }
        }
        found
    } else {
        vec![]
    };
    if items.is_empty() {
        return Err("Response is not an array".to_string());
    }
    let mut map: HashMap<String, String> = HashMap::new();
    for item in items.iter() {
        let id = item.get("id").and_then(Value::as_str).unwrap_or_default();
        let target = item
            .get("target")
            .or_else(|| item.get("translation"))
            .or_else(|| item.get("translated"))
            .or_else(|| item.get("text"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        if !id.is_empty() && !target.is_empty() {
            map.insert(id.to_string(), target.to_string());
        }
    }
    Ok(original_segments
        .iter()
        .map(|seg| TranslationResult {
            id: seg.id.clone(),
            target: map.get(&seg.id).cloned().unwrap_or_default(),
            valid: map.contains_key(&seg.id),
        })
        .collect())
}

fn provider_base(provider: &str) -> &'static str {
    match provider {
        "gemini" => "https://generativelanguage.googleapis.com",
        "deepseek" => "https://api.deepseek.com",
        "siliconflow" => "https://api.siliconflow.cn/v1",
        "mimo" => "https://api.xiaomimimo.com",
        _ => "https://api.openai.com",
    }
}

fn provider_model(provider: &str) -> &'static str {
    match provider {
        "gemini" => "gemini-2.5-flash-lite",
        "deepseek" => "deepseek-chat",
        "siliconflow" => "deepseek-ai/DeepSeek-V3",
        "mimo" => "mimo-v2-flash",
        _ => "gpt-4o-mini",
    }
}

static HTTP_CLIENT_POOL: OnceLock<Mutex<HashMap<u64, Client>>> = OnceLock::new();

fn get_http_client(timeout_ms: u64) -> Result<Client, String> {
    let pool = HTTP_CLIENT_POOL.get_or_init(|| Mutex::new(HashMap::new()));
    let mut guard = pool
        .lock()
        .map_err(|e| format!("HTTP 客户端池加锁失败: {}", e))?;
    if let Some(client) = guard.get(&timeout_ms) {
        return Ok(client.clone());
    }
    let client = Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .pool_max_idle_per_host(16)
        .tcp_nodelay(true)
        .build()
        .map_err(|e| format!("HTTP 客户端初始化失败: {}", e))?;
    guard.insert(timeout_ms, client.clone());
    Ok(client)
}

fn collect_error_sources(err: &dyn std::error::Error) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = err.source();
    while let Some(source) = current {
        out.push(source.to_string());
        current = source.source();
    }
    out
}

fn format_transport_error_message(
    prefix: &str,
    provider: &str,
    url: &str,
    segments: usize,
    body_bytes: usize,
    kind: &str,
    detail: &str,
    sources: &[String],
) -> String {
    let mut message = format!(
        "{} [{}] provider={} url={} segments={} body_bytes={} detail={}",
        prefix, kind, provider, url, segments, body_bytes, detail
    );
    if !sources.is_empty() {
        message.push_str(&format!("\ncauses: {}", sources.join(" | ")));
    }
    message
}

fn format_reqwest_transport_error(
    prefix: &str,
    provider: &str,
    url: &str,
    segments: usize,
    body_bytes: usize,
    error: &reqwest::Error,
) -> String {
    let kind = if error.is_timeout() {
        "timeout"
    } else if error.is_connect() {
        "connect"
    } else if error.is_body() {
        "body"
    } else if error.is_decode() {
        "decode"
    } else if error.is_request() {
        "request"
    } else if error.is_status() {
        "status"
    } else {
        "transport"
    };
    let sources = collect_error_sources(error);
    format_transport_error_message(
        prefix,
        provider,
        url,
        segments,
        body_bytes,
        kind,
        &error.to_string(),
        &sources,
    )
}

async fn translate_batch_inner(segments: Vec<Segment>, config: ApiConfig) -> Result<Vec<TranslationResult>, String> {
    let total_start = Instant::now();
    let payload = segments
        .iter()
        .map(|s| json!({ "id": s.id, "source": s.source }))
        .collect::<Vec<_>>();
    let timeout_ms = config.timeout_ms.unwrap_or(120000);
    let client_start = Instant::now();
    let client = get_http_client(timeout_ms)?;
    let client_ms = client_start.elapsed().as_millis();
    let provider = config.provider.clone();
    let base = if config.base_url.trim().is_empty() {
        provider_base(&provider).to_string()
    } else {
        config.base_url.trim().trim_end_matches('/').to_string()
    };
    let model = if config.model.trim().is_empty() {
        provider_model(&provider).to_string()
    } else {
        config.model.clone()
    };
    if provider == "gemini" {
        let url = format!(
            "{}/v1beta/models/{}:generateContent?key={}",
            base,
            urlencoding::encode(&model),
            urlencoding::encode(&config.api_key)
        );
        let body = json!({
          "contents": [{
            "role": "user",
            "parts": [{
              "text": format!("{}\n{}\n{}", config.system_prompt, config.user_prompt_prefix, Value::Array(payload.clone()))
            }]
          }],
          "generationConfig": {
            "response_mime_type": "application/json"
          }
        });
        let body_bytes = body.to_string().len();
        let request_start = Instant::now();
        let res = client
            .post(&url)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| {
                format_reqwest_transport_error(
                    "Gemini request failed",
                    &provider,
                    &url,
                    segments.len(),
                    body_bytes,
                    &e,
                )
            })?;
        let request_ms = request_start.elapsed().as_millis();
        let status = res.status();
        let body_start = Instant::now();
        let raw_text = res.text().await.map_err(|e| format!("Gemini 读取响应失败: {}", e))?;
        let body_ms = body_start.elapsed().as_millis();
        if !status.is_success() {
            return Err(format!("Gemini HTTP {} {}", status, raw_text));
        }
        let parse_json_start = Instant::now();
        let data: Value = serde_json::from_str(&raw_text).map_err(|e| format!("Gemini 返回 JSON 无效: {}", e))?;
        let parse_json_ms = parse_json_start.elapsed().as_millis();
        let content = data
            .get("candidates")
            .and_then(Value::as_array)
            .and_then(|arr| arr.first())
            .and_then(|v| v.get("content"))
            .and_then(|v| v.get("parts"))
            .and_then(Value::as_array)
            .and_then(|arr| arr.first())
            .and_then(|v| v.get("text"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let parse_result_start = Instant::now();
        let parsed = parse_translation_response(&content, &segments)?;
        let parse_result_ms = parse_result_start.elapsed().as_millis();
        let total_ms = total_start.elapsed().as_millis();
        eprintln!(
            "API_TIMING provider={} model={} timeout_ms={} segments={} client_ms={} request_ms={} body_ms={} parse_json_ms={} parse_result_ms={} total_ms={}",
            provider,
            model,
            timeout_ms,
            segments.len(),
            client_ms,
            request_ms,
            body_ms,
            parse_json_ms,
            parse_result_ms,
            total_ms
        );
        return Ok(parsed);
    }

    let mut base_with_v1 = base.clone();
    if !base_with_v1.ends_with("/v1") {
        base_with_v1 = format!("{}/v1", base_with_v1);
    }
    let mut body = json!({
      "model": model,
      "messages": [
        { "role": "system", "content": config.system_prompt },
        { "role": "user", "content": format!("{}\n\n{}", config.user_prompt_prefix, Value::Array(payload)) }
      ],
      "temperature": 0.1,
      "stream": false
    });
    if provider == "mimo" {
        body["thinking"] = json!({"type":"disabled"});
    }
    let request_url = format!("{}/chat/completions", base_with_v1);
    let body_bytes = body.to_string().len();
    let request_start = Instant::now();
    let res = client
        .post(&request_url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", config.api_key))
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            format_reqwest_transport_error(
                "OpenAI compatible request failed",
                &provider,
                &request_url,
                segments.len(),
                body_bytes,
                &e,
            )
        })?;
    let request_ms = request_start.elapsed().as_millis();
    let status = res.status();
    let body_start = Instant::now();
    let raw_text = res.text().await.map_err(|e| format!("读取响应失败: {}", e))?;
    let body_ms = body_start.elapsed().as_millis();
    if !status.is_success() {
        return Err(format!("OpenAI 兼容 HTTP {} {}", status, raw_text));
    }
    let parse_json_start = Instant::now();
    let data: Value = serde_json::from_str(&raw_text)
        .map_err(|e| format!("OpenAI 兼容返回 JSON 无效: {}", e))?;
    let parse_json_ms = parse_json_start.elapsed().as_millis();
    let content = data
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|arr| arr.first())
        .and_then(|v| v.get("message"))
        .and_then(|v| v.get("content"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let parse_result_start = Instant::now();
    let parsed = parse_translation_response(&content, &segments)?;
    let parse_result_ms = parse_result_start.elapsed().as_millis();
    let total_ms = total_start.elapsed().as_millis();
    eprintln!(
        "API_TIMING provider={} model={} timeout_ms={} segments={} client_ms={} request_ms={} body_ms={} parse_json_ms={} parse_result_ms={} total_ms={}",
        provider,
        model,
        timeout_ms,
        segments.len(),
        client_ms,
        request_ms,
        body_ms,
        parse_json_ms,
        parse_result_ms,
        total_ms
    );
    Ok(parsed)
}

#[tauri::command]
fn scan_segments(dir: String, rule: Rule) -> Result<ScanResult, String> {
    let (files, mut errors) = scan_files(&dir)?;
    let mut segs: Vec<Segment> = Vec::new();
    for f in files {
        let r = if f.kind == "json" {
            extract_from_json(&f.content, &f.path, &rule)
        } else {
            extract_from_text(&f.content, &f.path, &rule)
        };
        match r {
            Ok(mut s) => segs.append(&mut s),
            Err(e) => errors.push(ScanError {
                file: f.path,
                message: e,
            }),
        }
    }
    Ok(ScanResult { segments: segs, errors })
}

#[tauri::command]
async fn translate_batch(segments: Vec<Segment>, config: ApiConfig) -> Result<Vec<TranslationResult>, String> {
    translate_batch_inner(segments, config).await
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TranslationInput {
    id: String,
    target: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModItem {
    id: String,
    name: String,
    path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LangWorkflowConfig {
    lang_dir: String,
    #[serde(default)]
    lang_mode: Option<String>,
    mod_dir: String,
    language: String,
    #[serde(default)]
    no_str_pl_no_s: bool,
    #[serde(default)]
    python_path: Option<String>,
    #[serde(default)]
    gettext_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BridgeInlineToLangReport {
    po_path: String,
    mo_path: String,
    log_path: String,
    conflict_strategy: String,
    total_pairs: usize,
    conflict_count: usize,
    conflict_resolved_count: usize,
    conflict_skipped_count: usize,
    filled_count: usize,
    filled_msgstr_count: usize,
    filled_plural_count: usize,
    skipped_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgeInlineOptions {
    #[serde(default = "default_bridge_conflict_strategy")]
    conflict_strategy: String,
    #[serde(default)]
    array_match_by_id: bool,
}

fn default_bridge_conflict_strategy() -> String {
    "skip".to_string()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BridgePoToCodeReport {
    output_dir: String,
    po_path: String,
    replaced_text_count: usize,
    touched_file_count: usize,
    renamed_path_count: usize,
    replaced_lang_code_count: usize,
}

fn normalize_ext(path: PathBuf) -> PathBuf {
    if path.extension().is_some() {
        path
    } else {
        PathBuf::from(format!("{}.exe", path.to_string_lossy()))
    }
}

fn resolve_python_exe(python_path: Option<String>) -> PathBuf {
    if let Some(p) = python_path {
        let pp = PathBuf::from(p);
        if pp.exists() {
            return pp;
        }
    }
    if let Ok(exe) = env::current_exe() {
        if let Some(dir) = exe.parent() {
            // 1. Check for bundled runtime (production structure)
            let bundled = dir.join("runtime").join("python").join("python.exe");
            if bundled.exists() {
                return bundled;
            }
            // 2. Check for dev runtime (development structure: target/debug/../../src-tauri/runtime/python)
            let dev_bundled = dir.join("../../src-tauri/runtime/python/python.exe");
            if dev_bundled.exists() {
                return dev_bundled;
            }
        }
    }
    PathBuf::from("python")
}

fn resolve_gettext_tool(gettext_path: Option<String>, tool: &str) -> PathBuf {
    if let Some(base) = gettext_path {
        let p = PathBuf::from(base);
        if p.is_dir() {
            let candidate = normalize_ext(p.join(tool));
            if candidate.exists() {
                return candidate;
            }
        } else if p.exists() {
            return p;
        }
    }
    normalize_ext(PathBuf::from(tool))
}

fn run_cmd(program: &Path, args: &[String]) -> Result<String, String> {
    run_cmd_with_cwd(program, args, None, None)
}

fn run_cmd_with_cwd(program: &Path, args: &[String], cwd: Option<&Path>, pythonpath: Option<&Path>) -> Result<String, String> {
    let mut cmd = Command::new(program);
    cmd.args(args);
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    if let Some(pp) = pythonpath {
        cmd.env("PYTHONPATH", pp.to_string_lossy().to_string());
    }
    cmd.env("PYTHONUTF8", "1");
    cmd.env("PYTHONIOENCODING", "utf-8");
    #[cfg(windows)]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

    let out = cmd.output()
        .map_err(|e| format!("命令执行失败 {}: {}", program.display(), e))?;
    if !out.status.success() {
        let stderr = decode_command_output(&out.stderr);
        let stdout = decode_command_output(&out.stdout);
        return Err(format!(
            "命令执行失败 {} {:?}\nstdout:\n{}\nstderr:\n{}",
            program.display(),
            args,
            stdout,
            stderr
        ));
    }
    Ok(decode_command_output(&out.stdout))
}

fn ensure_python_module(python: &Path, module: &str) -> Result<(), String> {
    let check_args = vec!["-c".to_string(), format!("import {}", module)];
    if run_cmd(python, &check_args).is_ok() {
        return Ok(());
    }
    let install_args = vec![
        "-m".to_string(),
        "pip".to_string(),
        "install".to_string(),
        "--disable-pip-version-check".to_string(),
        module.to_string(),
    ];
    if run_cmd(python, &install_args).is_err() {
        let ensurepip_args = vec![
            "-m".to_string(),
            "ensurepip".to_string(),
            "--upgrade".to_string(),
        ];
        let _ = run_cmd(python, &ensurepip_args);
        run_cmd(python, &install_args).map_err(|e| {
            format!(
                "自动安装 Python 模块 {} 失败，请检查 Python/pip 或网络是否可用。\n{}",
                module,
                e
            )
        })?;
    }
    run_cmd(python, &check_args)
        .map(|_| ())
        .map_err(|e| format!("Python 模块 {} 安装后校验失败：{}", module, e))
}

fn ensure_polib(python: &Path) -> Result<(), String> {
    ensure_python_module(python, "polib")
}

fn normalize_lang_code(value: &str) -> String {
    value.trim().to_ascii_lowercase().replace('-', "_")
}

fn is_single_plural_language(value: &str) -> bool {
    let normalized = normalize_lang_code(value);
    let base = normalized.split('_').next().unwrap_or("");
    matches!(base, "zh" | "ja" | "ko" | "th" | "vi" | "id" | "tr")
}

fn lang_normalize_po_file_with_mode(
    config: &LangWorkflowConfig,
    po_file: &Path,
    preserve_extra_plural_slots: bool,
) -> Result<(), String> {
    let python = resolve_python_exe(config.python_path.clone());
    ensure_polib(&python)?;
    let py_code = r#"
import re
import sys
import polib

po_path = sys.argv[1]
lang = str(sys.argv[2] or "").strip()
preserve_extra_plural_slots = str(sys.argv[3] or "").strip() == "1"
po = polib.pofile(po_path)

plural_rules = {
    "zh": "nplurals=1; plural=0;",
    "zh_cn": "nplurals=1; plural=0;",
    "zh_tw": "nplurals=1; plural=0;",
    "zh_hk": "nplurals=1; plural=0;",
    "ja": "nplurals=1; plural=0;",
    "ko": "nplurals=1; plural=0;",
    "th": "nplurals=1; plural=0;",
    "vi": "nplurals=1; plural=0;",
    "id": "nplurals=1; plural=0;",
    "tr": "nplurals=1; plural=0;",
    "fr": "nplurals=2; plural=(n > 1);",
    "pt_br": "nplurals=2; plural=(n > 1);",
    "ru": "nplurals=3; plural=(n%10==1 and n%100!=11 ? 0 : n%10>=2 and n%10<=4 and (n%100<12 or n%100>14) ? 1 : 2);",
    "ru_ru": "nplurals=3; plural=(n%10==1 and n%100!=11 ? 0 : n%10>=2 and n%10<=4 and (n%100<12 or n%100>14) ? 1 : 2);",
    "uk": "nplurals=3; plural=(n%10==1 and n%100!=11 ? 0 : n%10>=2 and n%10<=4 and (n%100<12 or n%100>14) ? 1 : 2);",
    "uk_ua": "nplurals=3; plural=(n%10==1 and n%100!=11 ? 0 : n%10>=2 and n%10<=4 and (n%100<12 or n%100>14) ? 1 : 2);",
    "cs": "nplurals=3; plural=(n==1 ? 0 : n>=2 and n<=4 ? 1 : 2);",
    "sk": "nplurals=3; plural=(n==1 ? 0 : n>=2 and n<=4 ? 1 : 2);",
    "pl": "nplurals=3; plural=(n==1 ? 0 : n%10>=2 and n%10<=4 and (n%100<12 or n%100>14) ? 1 : 2);",
    "ar": "nplurals=6; plural=(n==0 ? 0 : n==1 ? 1 : n==2 ? 2 : n%100>=3 and n%100<=10 ? 3 : n%100>=11 and n%100<=99 ? 4 : 5);",
}

def pick_plural_rule(lang_code: str):
    key = str(lang_code or "").strip().lower().replace("-", "_")
    if key in plural_rules:
        return plural_rules[key]
    base = key.split("_")[0] if key else ""
    if base in plural_rules:
        return plural_rules[base]
    return "nplurals=2; plural=(n != 1);"

resolved_lang = lang if lang else str(po.metadata.get("Language", "") or "").strip()
if not resolved_lang:
    resolved_lang = "en"
plural_forms = pick_plural_rule(resolved_lang)
match = re.search(r"nplurals\s*=\s*(\d+)", plural_forms)
nplurals = int(match.group(1)) if match else 2

meta = dict(po.metadata or {})
if not str(meta.get("Project-Id-Version", "")).strip():
    meta["Project-Id-Version"] = "Unknown Mod"
meta["Language"] = resolved_lang
meta["MIME-Version"] = "1.0"
meta["Content-Type"] = "text/plain; charset=UTF-8"
meta["Content-Transfer-Encoding"] = "8bit"
meta["Plural-Forms"] = plural_forms
po.metadata = meta

for e in po:
    if e.obsolete:
        continue
    if e.msgid_plural:
        existing = {str(k): str(v or "") for k, v in dict(e.msgstr_plural or {}).items()}
        base = existing.get("0", "")
        if not base and e.msgstr is not None:
            base = str(e.msgstr or "")
        if preserve_extra_plural_slots and nplurals == 1:
            fixed = {"0": base}
            for key, value in existing.items():
                key = str(key)
                value = str(value or "")
                if key == "0" or not value.strip():
                    continue
                fixed[key] = value
        else:
            fixed = {str(i): existing.get(str(i), "") for i in range(nplurals)}
        e.msgstr_plural = fixed
        e.msgstr = None
    else:
        e.msgstr = str(e.msgstr or "")
        e.msgstr_plural = {}

po.save(po_path)
"#
    .to_string();
    let args = vec![
        "-c".to_string(),
        py_code,
        po_file.to_string_lossy().to_string(),
        config.language.clone(),
        if preserve_extra_plural_slots { "1".to_string() } else { "0".to_string() },
    ];
    run_cmd(&python, &args)
        .map(|_| ())
        .map_err(|e| format!("标准化 PO 失败 {}: {}", po_file.display(), e))
}

fn lang_normalize_po_file(config: &LangWorkflowConfig, po_file: &Path) -> Result<(), String> {
    lang_normalize_po_file_with_mode(config, po_file, true)
}

fn lang_validate_po_file(config: &LangWorkflowConfig, po_file: &Path) -> Result<(), String> {
    let python = resolve_python_exe(config.python_path.clone());
    ensure_polib(&python)?;
    let py_code = r#"
import re
import sys
import polib

po = polib.pofile(sys.argv[1])
meta = dict(po.metadata or {})
errors = []
content_type = str(meta.get("Content-Type", "") or "").strip().lower()
if "charset=utf-8" not in content_type:
errors.append("缺少 Content-Type 或 charset=UTF-8")
plural_forms = str(meta.get("Plural-Forms", "") or "").strip()
match = re.search(r"nplurals\s*=\s*(\d+)", plural_forms)
if not match:
    errors.append("缺少或无法解析 Plural-Forms nplurals")
    nplurals = 2
else:
    nplurals = int(match.group(1))
for e in po:
    if e.obsolete or not e.msgid_plural:
        continue
    mp = {str(k): str(v or "") for k, v in dict(e.msgstr_plural or {}).items()}
    missing = [str(i) for i in range(nplurals) if str(i) not in mp]
    if missing:
        errors.append(f"复数条目缺少 msgstr 索引 {','.join(missing)}: {str(e.msgid or '')[:80]}")
if errors:
    raise SystemExit("\n".join(errors))
"#
    .to_string();
    let args = vec![
        "-c".to_string(),
        py_code,
        po_file.to_string_lossy().to_string(),
    ];
    run_cmd(&python, &args)
        .map(|_| ())
        .map_err(|e| format!("PO 校验失败 {}:\n{}", po_file.display(), e))
}

fn extract_missing_python_module(err_text: &str) -> Option<String> {
    let re_need = Regex::new(r"You need '([A-Za-z0-9_\\.\\-]+)' module installed").ok()?;
    if let Some(caps) = re_need.captures(err_text) {
        return caps.get(1).map(|m| m.as_str().to_string());
    }
    let re_not_found = Regex::new(r#"No module named ['"]([A-Za-z0-9_\.\-]+)['"]"#).ok()?;
    if let Some(caps) = re_not_found.captures(err_text) {
        return caps.get(1).map(|m| m.as_str().to_string());
    }
    None
}

fn extract_unsupported_option(err_text: &str) -> Option<String> {
    let re = Regex::new(r"no such option:\s*([^\s]+)").ok()?;
    re.captures(err_text)
        .and_then(|caps| caps.get(1).map(|m| m.as_str().to_string()))
}

fn extract_unrecognized_object_file(err_text: &str) -> Option<String> {
    if !err_text.contains("Unrecognized object type") {
        return None;
    }
    let re = Regex::new(r"--- File:\s+'([^']+)'").ok()?;
    re.captures(err_text)
        .and_then(|caps| caps.get(1).map(|m| m.as_str().to_string()))
}

fn extract_cdda_json_error_file(err_text: &str) -> Option<String> {
    if !err_text.contains("Error in JSON object") {
        return None;
    }
    // Pattern: from file: '.\path\to\file.json'
    let re = Regex::new(r"from file:\s*'([^']+)'").ok()?;
    re.captures(err_text)
        .and_then(|caps| caps.get(1).map(|m| m.as_str().to_string()))
}

fn extract_unrecognized_object_type(err_text: &str) -> Option<String> {
    let re = Regex::new(r"Unrecognized object type '([^']+)'").ok()?;
    re.captures(err_text)
        .and_then(|caps| caps.get(1).map(|m| m.as_str().to_string()))
}

fn detect_extract_script_family(extract_script: &Path) -> String {
    let text = match read_text_file_with_fallback(extract_script) {
        Ok(v) => v,
        Err(_) => return "unknown".to_string(),
    };
    if text.contains("from string_extractor.parse import parse_json_file") {
        return "cdda".to_string();
    }
    if text.contains("import luaparser") && text.contains("automatically_convertible") {
        return "cbn".to_string();
    }
    "unknown".to_string()
}

fn normalize_lang_mode(mode: Option<String>, detected_family: &str) -> String {
    let v = mode.unwrap_or_default().trim().to_lowercase();
    if v == "cbn" || v == "cdda" {
        return v;
    }
    if detected_family == "cbn" || detected_family == "cdda" {
        return detected_family.to_string();
    }
    "cbn".to_string()
}

fn validate_lang_toolchain_layout(lang_dir: &str, family: &str) -> Result<(), String> {
    if family != "cbn" {
        return Ok(());
    }
    let root = PathBuf::from(lang_dir);
    let dedup = root.join("dedup_pot_file.py");
    let concat = root.join("concat_pot_files.py");
    let extract_mod_bat = root.join("extract_mod_strings.bat");
    if dedup.exists() && concat.exists() && extract_mod_bat.exists() {
        return Ok(());
    }
    Err(format!(
        "检测到当前提取脚本为 CBN 流程，但 lang 目录工具链不完整：{}\n缺失文件：{}{}{}\n请使用同一来源的 CBN lang 目录（至少含 extract_json_strings.py、dedup_pot_file.py、concat_pot_files.py、extract_mod_strings.bat）。",
        root.display(),
        if dedup.exists() { "" } else { "dedup_pot_file.py " },
        if concat.exists() { "" } else { "concat_pot_files.py " },
        if extract_mod_bat.exists() { "" } else { "extract_mod_strings.bat" }
    ))
}

fn run_python_script_help_probe(python: &Path, script: &Path, script_name: &str) -> Result<(), String> {
    let args = vec![
        script.to_string_lossy().to_string(),
        "--help".to_string(),
    ];
    let mut last_error = String::new();
    for _ in 0..4 {
        match run_cmd(python, &args) {
            Ok(_) => return Ok(()),
            Err(e) => {
                last_error = e.clone();
                if let Some(module) = extract_missing_python_module(&e) {
                    ensure_python_module(python, &module).map_err(|install_err| {
                        format!(
                            "CBN 调试自检失败：{} 缺少 Python 模块 {}，且自动安装失败。\n脚本：{}\n{}",
                            script_name,
                            module,
                            script.display(),
                            install_err
                        )
                    })?;
                    continue;
                }
                return Err(format!(
                    "CBN 调试自检失败：{} 无法执行。\n脚本：{}\n{}",
                    script_name,
                    script.display(),
                    e
                ));
            }
        }
    }
    Err(format!(
        "CBN 调试自检失败：{} 无法执行。\n脚本：{}\n{}",
        script_name,
        script.display(),
        last_error
    ))
}

fn run_cdda_script_with_runpy(
    python: &Path,
    script: &Path,
    lang_dir: &Path,
    run_args: &[String],
    cwd: &Path,
) -> Result<String, String> {
    let args_json = serde_json::to_string(run_args)
        .map_err(|e| format!("序列化 CDDA 提取参数失败: {}", e))?;
    let py_code = r#"
import json, runpy, sys
script = sys.argv[1]
lang_dir = sys.argv[2]
run_args = json.loads(sys.argv[3])
if lang_dir and lang_dir not in sys.path:
    sys.path.insert(0, lang_dir)
sys.argv = [script] + run_args
runpy.run_path(script, run_name="__main__")
"#
    .to_string();
    let args = vec![
        "-c".to_string(),
        py_code,
        script.to_string_lossy().to_string(),
        lang_dir.to_string_lossy().to_string(),
        args_json,
    ];
    run_cmd_with_cwd(python, &args, Some(cwd), None)
}

fn run_python_script_help_probe_cdda(python: &Path, script: &Path, lang_dir: &Path) -> Result<(), String> {
    let help_args = vec!["--help".to_string()];
    run_cdda_script_with_runpy(python, script, lang_dir, &help_args, lang_dir)
        .map(|_| ())
        .map_err(|e| {
            format!(
                "CDDA 调试自检失败：extract_json_strings.py 无法执行。\n脚本：{}\nlang 目录：{}\n{}",
                script.display(),
                lang_dir.display(),
                e
            )
        })
}

fn validate_cdda_toolchain_layout(lang_dir: &Path) -> Result<(), String> {
    let string_extractor_dir = lang_dir.join("string_extractor");
    if !string_extractor_dir.is_dir() {
        return Err(format!(
            "CDDA 模式配置错误：未在 lang 目录中找到 string_extractor 文件夹。\nlang 目录：{}",
            lang_dir.display()
        ));
    }
    let required_files = ["__init__.py", "parse.py", "pot_export.py"];
    let missing: Vec<&str> = required_files
        .iter()
        .copied()
        .filter(|f| !string_extractor_dir.join(f).exists())
        .collect();
    if missing.is_empty() {
        return Ok(());
    }
    Err(format!(
        "CDDA 模式配置错误：string_extractor 目录缺少必要文件。\n目录：{}\n缺失：{}",
        string_extractor_dir.display(),
        missing.join(", ")
    ))
}

fn build_cbn_extract_args(extract_script: &Path, excluded_files: &[String]) -> Vec<String> {
    let mut args = vec![
        extract_script.to_string_lossy().to_string(),
        "-i".to_string(),
        ".\\".to_string(),
        "-o".to_string(),
        "lang\\extracted_strings.pot".to_string(),
    ];
    for file in excluded_files {
        args.push("-e".to_string());
        args.push(file.clone());
    }
    args
}

fn build_cdda_extract_args(excluded_files: &[String]) -> Vec<String> {
    let mut args = vec![
        "-i".to_string(),
        ".\\".to_string(),
        "-r".to_string(),
        "lang\\extracted_strings.pot".to_string(),
    ];
    for file in excluded_files {
        args.push("-X".to_string());
        args.push(file.clone());
    }
    args
}

fn ensure_cdda_reference_pot(reference_file: &Path) -> Result<(), String> {
    let parent = reference_file
        .parent()
        .ok_or_else(|| format!("无效 reference 文件路径: {}", reference_file.display()))?;
    fs::create_dir_all(parent)
        .map_err(|e| format!("创建 reference POT 目录失败 {}: {}", parent.display(), e))?;
    if !reference_file.exists() {
        fs::write(reference_file, "")
            .map_err(|e| format!("创建空 reference POT 失败 {}: {}", reference_file.display(), e))?;
    }
    Ok(())
}

fn lang_generate_pot_cbn(
    config: &LangWorkflowConfig,
    python: &Path,
    extract_script: &Path,
    pot_file: &Path,
    script_family: &str,
) -> Result<String, String> {
    let dedup_script = PathBuf::from(&config.lang_dir).join("dedup_pot_file.py");
    if !dedup_script.exists() {
        return Err(format!("未找到 CBN 去重脚本: {}", dedup_script.display()));
    }
    run_python_script_help_probe(python, extract_script, "extract_json_strings.py")?;
    run_python_script_help_probe(python, &dedup_script, "dedup_pot_file.py")?;
    let mod_dir_path = PathBuf::from(&config.mod_dir);
    let mut excluded_files: Vec<String> = Vec::new();
    let mut last_error = String::new();
    for _ in 0..32 {
        let args = build_cbn_extract_args(extract_script, &excluded_files);
        let extract_result = run_cmd_with_cwd(python, &args, Some(&mod_dir_path), None);
        match extract_result {
            Ok(_) => {
                let dedup_args = vec![
                    dedup_script.to_string_lossy().to_string(),
                    "lang\\extracted_strings.pot".to_string(),
                ];
                run_cmd_with_cwd(python, &dedup_args, Some(&mod_dir_path), None).map_err(|e| {
                    format!(
                        "CBN 调试流程中 dedup_pot_file.py 执行失败。\n脚本：{}\nPOT：{}\n{}",
                        dedup_script.display(),
                        pot_file.display(),
                        e
                    )
                })?;
                return Ok(pot_file.to_string_lossy().to_string());
            }
            Err(e) => {
                last_error = e.clone();
                if let Some(module) = extract_missing_python_module(&e) {
                    ensure_python_module(python, &module)?;
                    continue;
                }
                if let Some(object_type) = extract_unrecognized_object_type(&e) {
                    let bad_file = extract_unrecognized_object_file(&e).unwrap_or_default();
                    if !bad_file.trim().is_empty() && !excluded_files.iter().any(|x| x == &bad_file) {
                        excluded_files.push(bad_file);
                        continue;
                    }
                    let file_hint = if bad_file.trim().is_empty() {
                        "".to_string()
                    } else {
                        format!("\n触发文件：{}", bad_file)
                    };
                    return Err(format!(
                        "提取 POT 前检查到外置 lang 脚本与 MOD 版本可能不匹配：不支持对象类型 '{}'。{}\
\n当前脚本：{}\
\n当前模式：cbn\
\n脚本类型：{}\
\n请优先使用与当前 MOD 版本匹配的 lang 目录（extract_json_strings.py）后重试。\
\n原始错误：\n{}",
                        object_type, file_hint, extract_script.display(), script_family, e
                    ));
                }
                if extract_unsupported_option(&e).is_some() {
                    break;
                }
                return Err(format!("提取 POT 失败：外置脚本执行异常。\n{}", e));
            }
        }
    }
    Err(format!(
        "提取 POT 失败：外置脚本执行异常。\n{}",
        last_error
    ))
}

fn lang_generate_pot_cdda(
    config: &LangWorkflowConfig,
    python: &Path,
    extract_script: &Path,
    pot_file: &Path,
    script_family: &str,
) -> Result<String, String> {
    let mod_dir_path = PathBuf::from(&config.mod_dir);
    let lang_dir_abs = fs::canonicalize(&config.lang_dir).unwrap_or_else(|_| PathBuf::from(&config.lang_dir));
    let lang_dir_clean = remove_unc_prefix(&lang_dir_abs);
    validate_cdda_toolchain_layout(&lang_dir_clean)?;
    run_python_script_help_probe_cdda(python, extract_script, &lang_dir_clean)?;
    ensure_cdda_reference_pot(pot_file)?;
    let diagnostic_info = format!(
        "lang 目录：{}\n脚本：{}\n工作目录：{}",
        lang_dir_clean.display(),
        extract_script.display(),
        mod_dir_path.display()
    );
    let mut excluded_files: Vec<String> = Vec::new();
    let mut last_error = String::new();
    for _ in 0..32 {
        let run_args = build_cdda_extract_args(&excluded_files);
        let extract_result = run_cdda_script_with_runpy(
            python,
            extract_script,
            &lang_dir_clean,
            &run_args,
            &mod_dir_path,
        );
        match extract_result {
            Ok(_) => return Ok(pot_file.to_string_lossy().to_string()),
            Err(e) => {
                last_error = e.clone();
                if let Some(module) = extract_missing_python_module(&e) {
                    if module == "string_extractor" {
                        return Err(format!(
                            "提取 POT 失败：CDDA 本地模块 'string_extractor' 缺失或未正确加载。\n{}\n错误详情：{}",
                            diagnostic_info, e
                        ));
                    }
                    ensure_python_module(python, &module)?;
                    continue;
                }
                if let Some(bad_file) = extract_cdda_json_error_file(&e) {
                    if !excluded_files.iter().any(|x| x == &bad_file) {
                        excluded_files.push(bad_file);
                        continue;
                    }
                }
                if let Some(object_type) = extract_unrecognized_object_type(&e) {
                    let bad_file = extract_unrecognized_object_file(&e).unwrap_or_default();
                    let file_hint = if bad_file.trim().is_empty() {
                        "".to_string()
                    } else {
                        format!("\n触发文件：{}", bad_file)
                    };
                    return Err(format!(
                        "提取 POT 前检查到外置 lang 脚本与 MOD 版本可能不匹配：不支持对象类型 '{}'。{}\
\n当前脚本：{}\
\n当前模式：cdda\
\n脚本类型：{}\
\n请优先使用与当前 MOD 版本匹配的 lang 目录（extract_json_strings.py）后重试。\
\n原始错误：\n{}",
                        object_type, file_hint, extract_script.display(), script_family, e
                    ));
                }
                if extract_unsupported_option(&e).is_some() {
                    break;
                }
                return Err(format!("提取 POT 失败：外置脚本执行异常。\n{}", e));
            }
        }
    }
    Err(format!(
        "提取 POT 失败：外置脚本执行异常。\n{}",
        last_error
    ))
}

fn lang_dir(mod_dir: &str) -> PathBuf {
    PathBuf::from(mod_dir).join("lang")
}

fn lang_mo_file(mod_dir: &str, language: &str, lang_mode: &str, domain: &str) -> PathBuf {
    if lang_mode == "cdda" {
        return lang_dir(mod_dir)
            .join("mo")
            .join(language)
            .join("LC_MESSAGES")
            .join(format!("{}.mo", domain));
    }
    lang_dir(mod_dir).join(format!("{}.mo", language))
}

fn lang_pot_file(mod_dir: &str, language: &str) -> PathBuf {
    let _ = language;
    lang_dir(mod_dir).join("extracted_strings.pot")
}

fn lang_po_file(mod_dir: &str, language: &str) -> PathBuf {
    lang_dir(mod_dir).join(format!("{}.po", language))
}

fn read_mod_id_from_modinfo(mod_dir: &str) -> Result<String, String> {
    let modinfo = PathBuf::from(mod_dir).join("modinfo.json");
    if modinfo.exists() {
        let text =
            fs::read_to_string(&modinfo).map_err(|e| format!("读取 modinfo 失败 {}: {}", modinfo.display(), e))?;
        if let Ok(value) = serde_json::from_str::<Value>(&text) {
            if let Some(arr) = value.as_array() {
                for item in arr {
                    let id = item.get("id").and_then(Value::as_str).unwrap_or("").trim();
                    if !id.is_empty() {
                        return Ok(id.to_string());
                    }
                }
            }
            if let Some(id) = value.get("id").and_then(Value::as_str) {
                let id = id.trim();
                if !id.is_empty() {
                    return Ok(id.to_string());
                }
            }
        }
    }
    let fallback = PathBuf::from(mod_dir)
        .file_name()
        .and_then(|x| x.to_str())
        .unwrap_or("translation")
        .to_string();
    Ok(fallback)
}

fn detect_lang_mode_from_config(config: &LangWorkflowConfig) -> String {
    let extract_script = PathBuf::from(&config.lang_dir).join("extract_json_strings.py");
    let script_family = if extract_script.exists() {
        detect_extract_script_family(&extract_script)
    } else {
        "unknown".to_string()
    };
    normalize_lang_mode(config.lang_mode.clone(), &script_family)
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    if dst.exists() {
        fs::remove_dir_all(dst)
            .map_err(|e| format!("清理输出目录失败 {}: {}", dst.display(), e))?;
    }
    fs::create_dir_all(dst)
        .map_err(|e| format!("创建输出目录失败 {}: {}", dst.display(), e))?;
    for entry in WalkDir::new(src).into_iter().filter_map(Result::ok) {
        let rel = entry
            .path()
            .strip_prefix(src)
            .map_err(|e| format!("计算相对路径失败: {}", e))?;
        let out_path = dst.join(rel);
        if entry.file_type().is_dir() {
            fs::create_dir_all(&out_path)
                .map_err(|e| format!("创建目录失败 {}: {}", out_path.display(), e))?;
            continue;
        }
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("创建目录失败 {}: {}", parent.display(), e))?;
        }
        fs::copy(entry.path(), &out_path).map_err(|e| {
            format!(
                "复制文件失败 {} -> {}: {}",
                entry.path().display(),
                out_path.display(),
                e
            )
        })?;
    }
    Ok(())
}

#[tauri::command]
fn lang_scan_mods(root_dir: String) -> Result<Vec<ModItem>, String> {
    if root_dir.trim().is_empty() {
        return Ok(vec![]);
    }
    let mut mods = Vec::new();
    for entry in WalkDir::new(&root_dir).into_iter().filter_map(Result::ok) {
        if !entry.file_type().is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name != "modinfo.json" {
            continue;
        }
        let modinfo_path = entry.path().to_path_buf();
        let mod_dir = match modinfo_path.parent() {
            Some(p) => p.to_path_buf(),
            None => continue,
        };
        let content = fs::read_to_string(&modinfo_path)
            .map_err(|e| format!("读取 modinfo 失败 {}: {}", modinfo_path.display(), e))?;
        let mut mod_id = String::new();
        let mut mod_name = String::new();
        if let Ok(value) = serde_json::from_str::<Value>(&content) {
            if let Some(arr) = value.as_array() {
                for item in arr {
                    let id = item.get("id").and_then(Value::as_str).unwrap_or("").trim();
                    if !id.is_empty() && mod_id.is_empty() {
                        mod_id = id.to_string();
                    }
                    let n = item
                        .get("name")
                        .and_then(Value::as_str)
                        .or_else(|| item.get("name").and_then(|v| v.get("str")).and_then(Value::as_str))
                        .unwrap_or("")
                        .trim();
                    if !n.is_empty() && mod_name.is_empty() {
                        mod_name = n.to_string();
                    }
                    if !mod_id.is_empty() && !mod_name.is_empty() {
                        break;
                    }
                }
            } else if value.is_object() {
                mod_id = value.get("id").and_then(Value::as_str).unwrap_or("").trim().to_string();
                mod_name = value
                    .get("name")
                    .and_then(Value::as_str)
                    .or_else(|| value.get("name").and_then(|v| v.get("str")).and_then(Value::as_str))
                    .unwrap_or("")
                    .trim()
                    .to_string();
            }
        }
        if mod_id.is_empty() {
            mod_id = mod_dir
                .file_name()
                .and_then(|x| x.to_str())
                .unwrap_or("unknown_mod")
                .to_string();
        }
        if mod_name.is_empty() {
            mod_name = mod_id.clone();
        }
        mods.push(ModItem {
            id: mod_id,
            name: mod_name,
            path: mod_dir.to_string_lossy().to_string(),
        });
    }
    mods.sort_by(|a, b| a.path.cmp(&b.path));
    mods.dedup_by(|a, b| a.path == b.path);
    Ok(mods)
}

#[tauri::command]
fn lang_extract_po_segments(config: LangWorkflowConfig) -> Result<Vec<Segment>, String> {
    let po_file = lang_po_file(&config.mod_dir, &config.language);
    let single_plural = is_single_plural_language(&config.language);
    if !po_file.exists() {
        return Err(format!("PO 文件不存在: {}", po_file.display()));
    }
    let python = resolve_python_exe(config.python_path.clone());
    ensure_polib(&python)?;
    let py_code = r#"
import json,sys,re
import polib
po = polib.pofile(sys.argv[1])
single_plural = str(sys.argv[2] or "").strip() == "1"
arr = []
for i, e in enumerate(po):
    if e.obsolete:
        continue
    if e.msgid_plural:
        plural_map = e.msgstr_plural or {}
        if single_plural:
            keys = ["0"]
        else:
            keys = sorted(plural_map.keys(), key=lambda x: int(x) if str(x).isdigit() else str(x))
            if not keys:
                keys = ["0", "1"]
        for k in keys:
            current = str(plural_map.get(k, "") or "").strip()
            if current:
                continue
            source = e.msgid if str(k) == "0" else e.msgid_plural
            if str(source or "").strip():
                arr.append({"id": f"p:{i}:{k}", "source": source})
        continue
    if not (e.msgstr or "").strip() and str(e.msgid or "").strip():
        arr.append({"id": f"s:{i}", "source": e.msgid})
print(json.dumps(arr, ensure_ascii=False))
"#.to_string();
    let args = vec![
        "-c".to_string(),
        py_code,
        po_file.to_string_lossy().to_string(),
        if single_plural { "1".to_string() } else { "0".to_string() },
    ];
    let out = run_cmd(&python, &args)?;
    let parsed: Vec<Value> = serde_json::from_str(&out).map_err(|e| format!("解析 PO 条目失败: {}", e))?;
    let mut segs = Vec::new();
    let po_path = po_file.to_string_lossy().to_string();
    for item in parsed {
        let id = item.get("id").and_then(Value::as_str).unwrap_or("").to_string();
        let source = item.get("source").and_then(Value::as_str).unwrap_or("").to_string();
        if id.is_empty() || source.trim().is_empty() {
            continue;
        }
        segs.push(Segment {
            id: format!("po:{}", id),
            file: po_path.clone(),
            path: vec!["po".to_string(), id],
            source: source.clone(),
            placeholders: detect_placeholders(&source),
        });
    }
    Ok(segs)
}

#[tauri::command]
fn lang_apply_po_translations(config: LangWorkflowConfig, translations: Vec<TranslationInput>) -> Result<usize, String> {
    let po_file = lang_po_file(&config.mod_dir, &config.language);
    if !po_file.exists() {
        return Err(format!("PO 文件不存在: {}", po_file.display()));
    }
    let python = resolve_python_exe(config.python_path.clone());
    ensure_polib(&python)?;
    let temp_json = lang_dir(&config.mod_dir).join(".po_ai_apply_temp.json");
    let mut cleaned = Vec::new();
    for t in translations {
        if t.target.trim().is_empty() {
            continue;
        }
        let raw_id = t.id.strip_prefix("po:").unwrap_or(&t.id).to_string();
        cleaned.push(TranslationInput {
            id: raw_id,
            target: t.target,
        });
    }
    let payload = serde_json::to_string(&cleaned).map_err(|e| format!("序列化翻译结果失败: {}", e))?;
    fs::write(&temp_json, payload)
        .map_err(|e| format!("写入临时翻译文件失败 {}: {}", temp_json.display(), e))?;
    let py_code = r#"
import json,sys
import polib
po = polib.pofile(sys.argv[1])
with open(sys.argv[2], "r", encoding="utf-8") as f:
    trs = json.load(f)
mp = {str(x.get("id","")): x.get("target","") for x in trs if str(x.get("id","")).strip() and str(x.get("target","")).strip()}
updated = 0
for i, e in enumerate(po):
    if e.obsolete:
        continue
    key_s = f"s:{i}"
    if key_s in mp:
        e.msgstr = mp[key_s]
        updated += 1
    if e.msgid_plural:
        e.msgstr_plural = {str(k): v for k, v in (e.msgstr_plural or {}).items()}
        for key, value in mp.items():
            parts = key.split(":")
            if len(parts) == 3 and parts[0] == "p" and parts[1] == str(i):
                e.msgstr_plural[str(parts[2])] = value
                updated += 1
po.save(sys.argv[1])
print(updated)
"#.to_string();
    let args = vec![
        "-c".to_string(),
        py_code,
        po_file.to_string_lossy().to_string(),
        temp_json.to_string_lossy().to_string(),
    ];
    let out = run_cmd(&python, &args)?;
    let _ = fs::remove_file(&temp_json);
    let updated = out.trim().parse::<usize>().unwrap_or(0);
    Ok(updated)
}

#[tauri::command]
fn lang_suggest_domain(mod_dir: String) -> Result<String, String> {
    read_mod_id_from_modinfo(&mod_dir)
}

#[tauri::command]
fn export_files(dir: String, translations: Vec<TranslationInput>, out_dir: String, rule: Rule) -> Result<bool, String> {
    let (files, read_errors) = scan_files(&dir)?;
    if !read_errors.is_empty() {
        let first = &read_errors[0];
        return Err(format!(
            "导出前读取源文件失败，共 {} 个。首个失败文件：{}，原因：{}",
            read_errors.len(),
            first.file,
            first.message
        ));
    }
    let mut map: HashMap<String, String> = HashMap::new();
    for t in translations {
        map.insert(t.id, t.target);
    }
    fs::create_dir_all(&out_dir).map_err(|e| format!("创建导出目录失败: {}", e))?;
    for f in files {
        let rel = Path::new(&f.path)
            .strip_prefix(Path::new(&dir))
            .map_err(|e| format!("计算相对路径失败: {}", e))?;
        let out_path = PathBuf::from(&out_dir).join(rel);
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("创建目录失败 {}: {}", parent.display(), e))?;
        }
        let out = if f.kind == "json" {
            write_back_json(&f.content, &map, &f.path)?
        } else {
            write_back_text(&f.content, &map, &f.path, &rule.regex)?
        };
        fs::write(&out_path, out).map_err(|e| format!("写入文件失败 {}: {}", out_path.display(), e))?;
    }
    Ok(true)
}

fn remove_unc_prefix(path: &Path) -> PathBuf {
    let s = path.to_string_lossy();
    if s.starts_with(r"\\?\") {
        PathBuf::from(&s[4..])
    } else {
        path.to_path_buf()
    }
}

#[tauri::command]
fn lang_generate_pot(config: LangWorkflowConfig) -> Result<String, String> {
    let extract_script = PathBuf::from(&config.lang_dir).join("extract_json_strings.py");
    if !extract_script.exists() {
        return Err(format!("未找到提取脚本: {}", extract_script.display()));
    }
    let script_family = detect_extract_script_family(&extract_script);
    let lang_mode = normalize_lang_mode(config.lang_mode.clone(), &script_family);
    if script_family != "unknown" && script_family != lang_mode {
        return Err(format!(
            "当前选择的 Lang 模式为 {}，但提取脚本识别为 {}。\n当前脚本：{}\n请切换 Lang 模式或改为匹配该模式的 lang 目录后重试。",
            lang_mode,
            script_family,
            extract_script.display()
        ));
    }
    validate_lang_toolchain_layout(&config.lang_dir, &lang_mode)?;
    let out_dir = lang_dir(&config.mod_dir);
    fs::create_dir_all(&out_dir).map_err(|e| format!("创建 lang 目录失败 {}: {}", out_dir.display(), e))?;
    let pot_file = lang_pot_file(&config.mod_dir, &config.language);
    validate_json_files_for_pot(&config.mod_dir)?;
    let python = resolve_python_exe(config.python_path.clone());
    ensure_polib(&python)?;
    let path = if lang_mode == "cbn" {
        lang_generate_pot_cbn(&config, &python, &extract_script, &pot_file, &script_family)?
    } else {
        lang_generate_pot_cdda(&config, &python, &extract_script, &pot_file, &script_family)?
    };
    post_process_generated_pot_plural_override(&config, &pot_file)?;
    Ok(path)
}

fn lang_generate_po_rewrite(config: &LangWorkflowConfig) -> Result<String, String> {
    let pot_file = lang_pot_file(&config.mod_dir, &config.language);
    if !pot_file.exists() {
        return Err(format!("未找到 POT 文件: {}", pot_file.display()));
    }
    let po_file = lang_po_file(&config.mod_dir, &config.language);
    let out_dir = po_file
        .parent()
        .ok_or_else(|| "无效 lang 目录".to_string())?;
    fs::create_dir_all(out_dir).map_err(|e| format!("创建 lang 目录失败 {}: {}", out_dir.display(), e))?;
    let msginit = resolve_gettext_tool(config.gettext_path.clone(), "msginit");
    if msginit.exists() {
        let args = vec![
            "--no-translator".to_string(),
            "-o".to_string(),
            po_file.to_string_lossy().to_string(),
            "-i".to_string(),
            pot_file.to_string_lossy().to_string(),
            "-l".to_string(),
            config.language.clone(),
        ];
        run_cmd(&msginit, &args)?;
    } else {
        let mut text = fs::read_to_string(&pot_file).map_err(|e| format!("读取 POT 失败: {}", e))?;
        text = text.replace("Language: en\\n", &format!("Language: {}\\n", config.language));
        fs::write(&po_file, text).map_err(|e| format!("写入 PO 失败 {}: {}", po_file.display(), e))?;
    }
    lang_normalize_po_file(config, &po_file)?;
    Ok(po_file.to_string_lossy().to_string())
}

#[tauri::command]
fn lang_generate_po(config: LangWorkflowConfig) -> Result<String, String> {
    let pot_file = lang_pot_file(&config.mod_dir, &config.language);
    if !pot_file.exists() {
        return Err(format!("未找到 POT 文件: {}", pot_file.display()));
    }
    let po_file = lang_po_file(&config.mod_dir, &config.language);
    if !po_file.exists() {
        return lang_generate_po_rewrite(&config);
    }
    let msgmerge = resolve_gettext_tool(config.gettext_path.clone(), "msgmerge");
    if msgmerge.exists() {
        let args = vec![
            "--update".to_string(),
            "--backup=none".to_string(),
            po_file.to_string_lossy().to_string(),
            pot_file.to_string_lossy().to_string(),
        ];
        run_cmd(&msgmerge, &args)?;
        lang_normalize_po_file(&config, &po_file)?;
        return Ok(po_file.to_string_lossy().to_string());
    }
    let python = resolve_python_exe(config.python_path.clone());
    ensure_polib(&python)?;
    let py_code = r#"
import sys
import polib
pot = polib.pofile(sys.argv[1])
old = polib.pofile(sys.argv[2])
lang = sys.argv[3]
old_map = {}
for e in old:
    if e.obsolete:
        continue
    k = (e.msgctxt or "", e.msgid or "", e.msgid_plural or "")
    old_map[k] = e
for e in pot:
    if e.obsolete:
        continue
    k = (e.msgctxt or "", e.msgid or "", e.msgid_plural or "")
    src = old_map.get(k)
    if src is None:
        continue
    e.msgstr = src.msgstr
    e.msgstr_plural = dict(src.msgstr_plural or {})
    e.flags = list(src.flags or [])
pot.metadata.update(old.metadata or {})
pot.metadata["Language"] = lang
pot.save(sys.argv[2])
"#.to_string();
    let args = vec![
        "-c".to_string(),
        py_code,
        pot_file.to_string_lossy().to_string(),
        po_file.to_string_lossy().to_string(),
        config.language.clone(),
    ];
    run_cmd(&python, &args)?;
    lang_normalize_po_file(&config, &po_file)?;
    Ok(po_file.to_string_lossy().to_string())
}

#[tauri::command]
fn lang_regenerate_po(config: LangWorkflowConfig) -> Result<String, String> {
    let po_file = lang_po_file(&config.mod_dir, &config.language);
    if po_file.exists() {
        let file_name = po_file
            .file_name()
            .and_then(|x| x.to_str())
            .ok_or_else(|| format!("无效 PO 文件名: {}", po_file.display()))?;
        let backup_file = po_file.with_file_name(format!("{}.bak", file_name));
        fs::copy(&po_file, &backup_file).map_err(|e| {
            format!(
                "备份 PO 失败 {} -> {}: {}",
                po_file.display(),
                backup_file.display(),
                e
            )
        })?;
    }
    lang_generate_po_rewrite(&config)
}

#[tauri::command]
fn lang_read_po(config: LangWorkflowConfig) -> Result<String, String> {
    let po_file = lang_po_file(&config.mod_dir, &config.language);
    if !po_file.exists() {
        return Err(format!("PO 文件不存在: {}", po_file.display()));
    }
    fs::read_to_string(&po_file).map_err(|e| format!("读取 PO 失败 {}: {}", po_file.display(), e))
}

#[tauri::command]
fn lang_write_po(config: LangWorkflowConfig, content: String) -> Result<String, String> {
    let po_file = lang_po_file(&config.mod_dir, &config.language);
    let parent = po_file
        .parent()
        .ok_or_else(|| "无效 lang 目录".to_string())?;
    fs::create_dir_all(parent).map_err(|e| format!("创建 lang 目录失败 {}: {}", parent.display(), e))?;
    fs::write(&po_file, content).map_err(|e| format!("写入 PO 失败 {}: {}", po_file.display(), e))?;
    lang_normalize_po_file(&config, &po_file)?;
    Ok(po_file.to_string_lossy().to_string())
}

#[tauri::command]
fn lang_compile_mo(config: LangWorkflowConfig) -> Result<String, String> {
    let po_file = lang_po_file(&config.mod_dir, &config.language);
    if !po_file.exists() {
        return Err(format!("PO 文件不存在: {}", po_file.display()));
    }
    let lang_mode = detect_lang_mode_from_config(&config);
    let domain = read_mod_id_from_modinfo(&config.mod_dir)?;
    let mo_file = lang_mo_file(&config.mod_dir, &config.language, &lang_mode, &domain);
    let mo_parent = mo_file
        .parent()
        .ok_or_else(|| "无效 lang 目录".to_string())?;
    fs::create_dir_all(mo_parent).map_err(|e| format!("创建 lang 目录失败 {}: {}", mo_parent.display(), e))?;
    let compile_po_file = lang_dir(&config.mod_dir).join(".compile_temp.po");
    let _ = fs::remove_file(&compile_po_file);
    fs::copy(&po_file, &compile_po_file)
        .map_err(|e| format!("复制编译临时 PO 失败 {} -> {}: {}", po_file.display(), compile_po_file.display(), e))?;
    lang_normalize_po_file_with_mode(&config, &compile_po_file, false)?;
    lang_validate_po_file(&config, &compile_po_file)?;
    let msgfmt = resolve_gettext_tool(config.gettext_path.clone(), "msgfmt");
    if msgfmt.exists() {
        let args = vec![
            "-o".to_string(),
            mo_file.to_string_lossy().to_string(),
            compile_po_file.to_string_lossy().to_string(),
        ];
        let result = run_cmd(&msgfmt, &args);
        let _ = fs::remove_file(&compile_po_file);
        result?;
        return Ok(mo_file.to_string_lossy().to_string());
    }
    let python = resolve_python_exe(config.python_path.clone());
    ensure_polib(&python)?;
    let py_code = "import polib,sys; polib.pofile(sys.argv[1]).save_as_mofile(sys.argv[2])".to_string();
    let args = vec![
        "-c".to_string(),
        py_code,
        compile_po_file.to_string_lossy().to_string(),
        mo_file.to_string_lossy().to_string(),
    ];
    let result = run_cmd(&python, &args).map_err(|e| {
        format!(
            "导出 MO 失败。msgfmt 不可用且 Python 回退失败。\n{}",
            e
        )
    });
    let _ = fs::remove_file(&compile_po_file);
    result?;
    Ok(mo_file.to_string_lossy().to_string())
}

#[tauri::command]
fn lang_cleanup_po_plural(config: LangWorkflowConfig) -> Result<usize, String> {
    let po_file = lang_po_file(&config.mod_dir, &config.language);
    if !po_file.exists() {
        return Err(format!("PO 文件不存在: {}", po_file.display()));
    }
    let python = resolve_python_exe(config.python_path.clone());
    ensure_polib(&python)?;
    let py_code = r#"
import sys
import re
import polib
po_path = sys.argv[1]
po = polib.pofile(po_path)
removed = 0
plural_forms = str((po.metadata or {}).get("Plural-Forms", "") or "")
match = re.search(r"nplurals\s*=\s*(\d+)", plural_forms)
nplurals = int(match.group(1)) if match else 2
for e in po:
    if e.obsolete or not e.msgid_plural:
        continue
    mp = {str(k): str(v or "") for k, v in dict(e.msgstr_plural or {}).items()}
    if nplurals == 1:
        fixed = {"0": mp.get("0", "")}
        for key, value in mp.items():
            key = str(key)
            value = str(value or "")
            if key == "0" or not value.strip():
                continue
            fixed[key] = value
    else:
        fixed = {str(i): mp.get(str(i), "") for i in range(nplurals)}
    if fixed != mp:
        e.msgstr_plural = fixed
        removed += 1
po.save(po_path)
print(removed)
"#
    .to_string();
    let args = vec![
        "-c".to_string(),
        py_code,
        po_file.to_string_lossy().to_string(),
    ];
    let out = run_cmd(&python, &args)?;
    lang_normalize_po_file(&config, &po_file)?;
    Ok(out.trim().parse::<usize>().unwrap_or(0))
}

#[tauri::command]
fn lang_bridge_inline_to_lang(
    config: LangWorkflowConfig,
    translated_mod_dir: String,
    options: Option<BridgeInlineOptions>,
) -> Result<BridgeInlineToLangReport, String> {
    if translated_mod_dir.trim().is_empty() {
        return Err("翻译版 MOD 目录不能为空".to_string());
    }
    let translated_path = PathBuf::from(&translated_mod_dir);
    if !translated_path.exists() {
        return Err(format!("翻译版 MOD 目录不存在: {}", translated_path.display()));
    }
    lang_generate_pot(config.clone())?;
    lang_generate_po(config.clone())?;
    let po_file = lang_po_file(&config.mod_dir, &config.language);
    if !po_file.exists() {
        return Err(format!("PO 文件不存在: {}", po_file.display()));
    }
    let single_plural = is_single_plural_language(&config.language);
    let python = resolve_python_exe(config.python_path.clone());
    ensure_polib(&python)?;
    let bridge_options = options.unwrap_or(BridgeInlineOptions {
        conflict_strategy: default_bridge_conflict_strategy(),
        array_match_by_id: false,
    });
    let options_json = serde_json::to_string(&bridge_options)
        .map_err(|e| format!("序列化桥接选项失败: {}", e))?;
    let py_code = r#"
import json, os, sys
from datetime import datetime
import polib
src_root = sys.argv[1]
tr_root = sys.argv[2]
po_path = sys.argv[3]
options = json.loads(sys.argv[4] or "{}")
single_plural = str(sys.argv[5] or "").strip() == "1"
conflict_strategy = str(options.get("conflictStrategy") or "skip").strip().lower()
if conflict_strategy not in ("skip", "frequency", "frequency2"):
    conflict_strategy = "skip"
array_match_by_id = bool(options.get("arrayMatchById"))
mapping = {}
candidates = {}
conflicts = []
total_pairs = 0
unmatched = []
def add_pair(src, dst, src_file, tr_file, json_path):
    global total_pairs
    src = str(src or "").strip()
    dst = str(dst or "").strip()
    if not src or not dst or src == dst:
        return
    total_pairs += 1
    entry = candidates.get(src)
    if entry is None:
        entry = {}
        candidates[src] = entry
    dst_rec = entry.get(dst)
    if dst_rec is None:
        dst_rec = {"count": 0, "locations": []}
        entry[dst] = dst_rec
    dst_rec["count"] += 1
    if len(dst_rec["locations"]) < 12:
        dst_rec["locations"].append({
            "srcFile": src_file,
            "trFile": tr_file,
            "jsonPath": json_path
        })
def can_match_by_id(a, b):
    if not array_match_by_id:
        return False
    if not a or not b:
        return False
    def valid_item(x):
        return isinstance(x, dict) and isinstance(x.get("id"), str) and str(x.get("id")).strip()
    if not all(valid_item(x) for x in a):
        return False
    if not all(valid_item(x) for x in b):
        return False
    ids_a = [str(x.get("id")).strip() for x in a]
    ids_b = [str(x.get("id")).strip() for x in b]
    return len(ids_a) == len(set(ids_a)) and len(ids_b) == len(set(ids_b))
def record_unmatched(kind, src_file, tr_file, json_path, detail):
    if len(unmatched) >= 600:
        return
    unmatched.append({
        "type": kind,
        "srcFile": src_file,
        "trFile": tr_file,
        "jsonPath": json_path,
        "detail": detail
    })
def walk_pair(a, b, src_file, tr_file, json_path=""):
    if isinstance(a, dict) and isinstance(b, dict):
        miss_src = sorted(list(set(a.keys()) - set(b.keys())))
        miss_tr = sorted(list(set(b.keys()) - set(a.keys())))
        if miss_src:
            record_unmatched("missing_key_in_translated", src_file, tr_file, json_path, ",".join(miss_src[:8]))
        if miss_tr:
            record_unmatched("extra_key_in_translated", src_file, tr_file, json_path, ",".join(miss_tr[:8]))
        for k in set(a.keys()) & set(b.keys()):
            child = f"{json_path}.{k}" if json_path else str(k)
            walk_pair(a[k], b[k], src_file, tr_file, child)
        return
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            record_unmatched("array_length_diff", src_file, tr_file, json_path, f"src={len(a)},tr={len(b)}")
        if can_match_by_id(a, b):
            map_b = {str(x.get("id")).strip(): x for x in b}
            for idx, item in enumerate(a):
                sid = str(item.get("id")).strip()
                if sid in map_b:
                    child = f"{json_path}[id={sid}]"
                    walk_pair(item, map_b[sid], src_file, tr_file, child)
                else:
                    child = f"{json_path}[{idx}]"
                    record_unmatched("missing_id_in_translated", src_file, tr_file, child, sid)
            return
        for i in range(min(len(a), len(b))):
            child = f"{json_path}[{i}]"
            walk_pair(a[i], b[i], src_file, tr_file, child)
        return
    if isinstance(a, str) and isinstance(b, str):
        add_pair(a, b, src_file, tr_file, json_path)
        return
    if type(a) != type(b):
        record_unmatched("type_mismatch", src_file, tr_file, json_path, f"{type(a).__name__}!={type(b).__name__}")
for root, _, files in os.walk(src_root):
    for name in files:
        if not name.lower().endswith('.json'):
            continue
        src_file = os.path.join(root, name)
        rel = os.path.relpath(src_file, src_root)
        tr_file = os.path.join(tr_root, rel)
        if not os.path.exists(tr_file):
            continue
        try:
            with open(src_file, 'r', encoding='utf-8') as f:
                a = json.load(f)
            with open(tr_file, 'r', encoding='utf-8') as f:
                b = json.load(f)
        except Exception as ex:
            record_unmatched("json_parse_error", src_file, tr_file, "", str(ex))
            continue
        walk_pair(a, b, src_file, tr_file, "")
for src, variant_map in candidates.items():
    if not variant_map:
        continue
    if len(variant_map) == 1:
        only_key = next(iter(variant_map.keys()))
        mapping[src] = only_key
        continue
    ranked = sorted(variant_map.items(), key=lambda x: (-int(x[1]["count"]), x[0]))
    decision = "skip"
    chosen = None
    if conflict_strategy in ("frequency", "frequency2"):
        if len(ranked) >= 2:
            first_count = int(ranked[0][1]["count"])
            second_count = int(ranked[1][1]["count"])
            if first_count > second_count:
                chosen = ranked[0][0]
                decision = "choose_frequency"
            elif conflict_strategy == "frequency2":
                chosen = ranked[0][0]
                decision = "choose_first_tie"
    if chosen is not None:
        mapping[src] = chosen
    conflicts.append({
        "sourceText": src,
        "decision": decision,
        "chosen": chosen,
        "candidates": [
            {
                "text": text,
                "count": int(meta["count"]),
                "locations": meta["locations"]
            }
            for text, meta in ranked
        ]
    })
po = polib.pofile(po_path)
filled_msgstr = 0
filled_plural = 0
skipped = 0
def normalize_plural_map(entry):
    raw = dict(entry.msgstr_plural or {})
    return {str(k): str(v or "") for k, v in raw.items()}
for e in po:
    if e.obsolete:
        continue
    if e.msgid_plural:
        changed = False
        e.msgstr_plural = normalize_plural_map(e)
        singular_key = str(e.msgid or "").strip()
        plural_key = str(e.msgid_plural or "").strip()
        if singular_key and singular_key in mapping:
            mp = normalize_plural_map(e)
            if str(mp.get("0", "") or "") != mapping[singular_key]:
                mp["0"] = mapping[singular_key]
                e.msgstr_plural = mp
                filled_plural += 1
                changed = True
        if plural_key and plural_key in mapping:
            mp = normalize_plural_map(e)
            plural_value = mapping[plural_key]
            if single_plural:
                if plural_value and plural_value != str(mp.get("0", "") or ""):
                    if str(mp.get("1", "") or "") != plural_value:
                        mp["1"] = plural_value
                        filled_plural += 1
                        changed = True
            else:
                keys = list(mp.keys()) if mp else ["0", "1"]
                for k in keys:
                    if str(k) == "0":
                        continue
                    key = str(k)
                    if str(mp.get(key, "") or "") != plural_value:
                        mp[key] = plural_value
                        filled_plural += 1
                        changed = True
            e.msgstr_plural = mp
        if not changed:
            skipped += 1
        continue
    key = str(e.msgid or "").strip()
    if key and key in mapping and str(e.msgstr or "") != mapping[key]:
        e.msgstr = mapping[key]
        filled_msgstr += 1
    else:
        skipped += 1
po.save(po_path)
conflict_resolved_count = sum(1 for c in conflicts if c.get("chosen") is not None)
conflict_skipped_count = len(conflicts) - conflict_resolved_count
log_dir = os.path.join(os.path.dirname(po_path), "bridge_logs")
os.makedirs(log_dir, exist_ok=True)
base = os.path.splitext(os.path.basename(po_path))[0]
stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
log_path = os.path.join(log_dir, f"inline_bridge_{base}_{stamp}.json")
with open(log_path, "w", encoding="utf-8") as f:
    json.dump({
        "summary": {
            "totalPairs": total_pairs,
            "mappingCount": len(mapping),
            "conflictCount": len(conflicts),
            "conflictResolvedCount": conflict_resolved_count,
            "conflictSkippedCount": conflict_skipped_count,
            "unmatchedCount": len(unmatched),
            "filledMsgstrCount": filled_msgstr,
            "filledPluralCount": filled_plural,
            "skippedCount": skipped,
            "conflictStrategy": conflict_strategy,
            "arrayMatchById": array_match_by_id
        },
        "conflicts": conflicts,
        "unmatched": unmatched
    }, f, ensure_ascii=False, indent=2)
print(json.dumps({
    "totalPairs": total_pairs,
    "conflictCount": len(conflicts),
    "conflictResolvedCount": conflict_resolved_count,
    "conflictSkippedCount": conflict_skipped_count,
    "conflictStrategy": conflict_strategy,
    "mappingCount": len(mapping),
    "filledCount": filled_msgstr + filled_plural,
    "filledMsgstrCount": filled_msgstr,
    "filledPluralCount": filled_plural,
    "skippedCount": skipped,
    "logPath": log_path
}, ensure_ascii=False))
"#
    .to_string();
    let args = vec![
        "-c".to_string(),
        py_code,
        config.mod_dir.clone(),
        translated_mod_dir.clone(),
        po_file.to_string_lossy().to_string(),
        options_json,
        if single_plural { "1".to_string() } else { "0".to_string() },
    ];
    let out = run_cmd(&python, &args)?;
    let report: Value =
        serde_json::from_str(out.trim()).map_err(|e| format!("解析迁移报告失败: {}", e))?;
    let mo_path = lang_compile_mo(config.clone())?;
    let filled_msgstr_count = report
        .get("filledMsgstrCount")
        .and_then(Value::as_u64)
        .unwrap_or(0) as usize;
    let filled_plural_count = report
        .get("filledPluralCount")
        .and_then(Value::as_u64)
        .unwrap_or(0) as usize;
    Ok(BridgeInlineToLangReport {
        po_path: po_file.to_string_lossy().to_string(),
        mo_path,
        log_path: report
            .get("logPath")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        conflict_strategy: report
            .get("conflictStrategy")
            .and_then(Value::as_str)
            .unwrap_or("skip")
            .to_string(),
        total_pairs: report
            .get("totalPairs")
            .and_then(Value::as_u64)
            .unwrap_or(0) as usize,
        conflict_count: report
            .get("conflictCount")
            .and_then(Value::as_u64)
            .unwrap_or(0) as usize,
        conflict_resolved_count: report
            .get("conflictResolvedCount")
            .and_then(Value::as_u64)
            .unwrap_or(0) as usize,
        conflict_skipped_count: report
            .get("conflictSkippedCount")
            .and_then(Value::as_u64)
            .unwrap_or(0) as usize,
        filled_count: report
            .get("filledCount")
            .and_then(Value::as_u64)
            .map(|v| v as usize)
            .unwrap_or(filled_msgstr_count + filled_plural_count),
        filled_msgstr_count,
        filled_plural_count,
        skipped_count: report
            .get("skippedCount")
            .and_then(Value::as_u64)
            .unwrap_or(0) as usize,
    })
}

#[tauri::command]
fn lang_bridge_po_to_code(
    config: LangWorkflowConfig,
    source_language_code: String,
    target_language_code: String,
    output_dir: String,
) -> Result<BridgePoToCodeReport, String> {
    if output_dir.trim().is_empty() {
        return Err("输出目录不能为空".to_string());
    }
    let src_mod = PathBuf::from(&config.mod_dir);
    if !src_mod.exists() {
        return Err(format!("MOD 目录不存在: {}", src_mod.display()));
    }
    let po_file = lang_po_file(&config.mod_dir, &config.language);
    if !po_file.exists() {
        return Err(format!("PO 文件不存在: {}", po_file.display()));
    }
    let out_path = PathBuf::from(&output_dir);
    copy_dir_recursive(&src_mod, &out_path)?;
    let python = resolve_python_exe(config.python_path.clone());
    ensure_polib(&python)?;
    let py_code = r#"
import json, os, sys
import polib
out_root = sys.argv[1]
po_path = sys.argv[2]
src_code = str(sys.argv[3] or "").strip()
tgt_code = str(sys.argv[4] or "").strip()
po = polib.pofile(po_path)
mapping = {}
for e in po:
    if e.obsolete:
        continue
    key = str(e.msgid or "").strip()
    val = str(e.msgstr or "").strip()
    if key and val:
        mapping[key] = val
replaced_text_count = 0
replaced_lang_code_count = 0
touched_files = 0
def walk_replace(v):
    global replaced_text_count, replaced_lang_code_count
    if isinstance(v, dict):
        changed = False
        out = {}
        for k, val in v.items():
            nv, c = walk_replace(val)
            out[k] = nv
            changed = changed or c
        return out, changed
    if isinstance(v, list):
        changed = False
        arr = []
        for item in v:
            ni, c = walk_replace(item)
            arr.append(ni)
            changed = changed or c
        return arr, changed
    if isinstance(v, str):
        changed = False
        out = v
        if out in mapping and mapping[out] != out:
            out = mapping[out]
            replaced_text_count += 1
            changed = True
        if src_code and tgt_code and src_code in out:
            replaced = out.replace(src_code, tgt_code)
            if replaced != out:
                replaced_lang_code_count += 1
                out = replaced
                changed = True
        return out, changed
    return v, False
for root, _, files in os.walk(out_root):
    for name in files:
        if not name.lower().endswith('.json'):
            continue
        p = os.path.join(root, name)
        try:
            with open(p, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception:
            continue
        new_data, changed = walk_replace(data)
        if changed:
            touched_files += 1
            with open(p, 'w', encoding='utf-8') as f:
                json.dump(new_data, f, ensure_ascii=False, indent=2)
                f.write('\n')
renamed_path_count = 0
if src_code and tgt_code:
    paths = []
    for root, dirs, files in os.walk(out_root):
        for name in dirs:
            paths.append(os.path.join(root, name))
        for name in files:
            paths.append(os.path.join(root, name))
    paths.sort(key=lambda p: len(p), reverse=True)
    for p in paths:
        base = os.path.basename(p)
        if src_code not in base:
            continue
        new_base = base.replace(src_code, tgt_code)
        if new_base == base:
            continue
        new_path = os.path.join(os.path.dirname(p), new_base)
        if os.path.exists(new_path):
            continue
        os.rename(p, new_path)
        renamed_path_count += 1
print(json.dumps({
    "replacedTextCount": replaced_text_count,
    "touchedFileCount": touched_files,
    "renamedPathCount": renamed_path_count,
    "replacedLangCodeCount": replaced_lang_code_count
}, ensure_ascii=False))
"#
    .to_string();
    let args = vec![
        "-c".to_string(),
        py_code,
        output_dir.clone(),
        po_file.to_string_lossy().to_string(),
        source_language_code,
        target_language_code,
    ];
    let out = run_cmd(&python, &args)?;
    let report: Value =
        serde_json::from_str(out.trim()).map_err(|e| format!("解析反向转换报告失败: {}", e))?;
    Ok(BridgePoToCodeReport {
        output_dir,
        po_path: po_file.to_string_lossy().to_string(),
        replaced_text_count: report
            .get("replacedTextCount")
            .and_then(Value::as_u64)
            .unwrap_or(0) as usize,
        touched_file_count: report
            .get("touchedFileCount")
            .and_then(Value::as_u64)
            .unwrap_or(0) as usize,
        renamed_path_count: report
            .get("renamedPathCount")
            .and_then(Value::as_u64)
            .unwrap_or(0) as usize,
        replaced_lang_code_count: report
            .get("replacedLangCodeCount")
            .and_then(Value::as_u64)
            .unwrap_or(0) as usize,
    })
}

#[tauri::command]
fn select_folder() -> Result<Option<String>, String> {
    let picked = rfd::FileDialog::new().pick_folder();
    Ok(picked.map(|p| p.to_string_lossy().to_string()))
}

fn user_config_path() -> Result<PathBuf, String> {
    let exe = env::current_exe().map_err(|e| format!("获取程序路径失败: {}", e))?;
    let dir = exe
        .parent()
        .ok_or_else(|| "无法获取程序目录".to_string())?;
    Ok(dir.join("user_config.json"))
}

#[tauri::command]
fn load_user_config() -> Result<Option<String>, String> {
    let path = user_config_path()?;
    if !path.exists() {
        return Ok(None);
    }
    let content =
        fs::read_to_string(&path).map_err(|e| format!("读取用户配置失败 {}: {}", path.display(), e))?;
    Ok(Some(content))
}

#[tauri::command]
fn save_user_config(content: String) -> Result<String, String> {
    let path = user_config_path()?;
    let mut root =
        serde_json::from_str::<Value>(&content).map_err(|e| format!("用户配置 JSON 无效: {}", e))?;
    if let Some(config) = root.get_mut("config").and_then(Value::as_object_mut) {
        let remember_key = config.get("rememberKey").and_then(Value::as_bool).unwrap_or(false);
        if !remember_key {
            config.insert("apiKey".to_string(), Value::String(String::new()));
        }
    }
    let serialized = serde_json::to_string(&root).map_err(|e| format!("序列化用户配置失败: {}", e))?;
    fs::write(&path, serialized).map_err(|e| format!("写入用户配置失败 {}: {}", path.display(), e))?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn get_user_config_path() -> Result<String, String> {
    Ok(user_config_path()?.to_string_lossy().to_string())
}

#[tauri::command]
fn save_preset_json(dir: String, file_name: String, content: String) -> Result<String, String> {
    if dir.trim().is_empty() {
        return Err("目录不能为空".to_string());
    }
    if file_name.trim().is_empty() {
        return Err("文件名不能为空".to_string());
    }
    let out_path = PathBuf::from(dir).join(file_name);
    fs::write(&out_path, content)
        .map_err(|e| format!("写入预设文件失败 {}: {}", out_path.display(), e))?;
    Ok(out_path.to_string_lossy().to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            scan_segments,
            translate_batch,
            export_files,
            lang_generate_pot,
            lang_generate_po,
            lang_regenerate_po,
            lang_read_po,
            lang_write_po,
            lang_extract_po_segments,
            lang_apply_po_translations,
            lang_compile_mo,
            lang_cleanup_po_plural,
            lang_bridge_inline_to_lang,
            lang_bridge_po_to_code,
            lang_suggest_domain,
            lang_scan_mods,
            select_folder,
            load_user_config,
            save_user_config,
            get_user_config_path,
            save_preset_json
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn collects_names_without_str_pl() {
        let value = json!([
            {
                "type": "MONSTER",
                "name": { "str": "mad doctor" }
            },
            {
                "type": "GUN",
                "name": { "str": "prototype rifle" }
            },
            {
                "type": "MONSTER",
                "name": { "str": "has plural", "str_pl": "has plurals" }
            }
        ]);

        let names = collect_names_without_str_pl_from_value(&value);

        assert!(names.contains("mad doctor"));
        assert!(names.contains("prototype rifle"));
        assert!(!names.contains("has plural"));
    }

    #[test]
    fn rewrites_only_synthetic_plural_suffixes() {
        let content = concat!(
            "#: .\\\\feral_humansT3.json\n",
            "msgid \"mad doctor\"\n",
            "msgid_plural \"mad doctors\"\n",
            "msgstr[0] \"\"\n",
            "msgstr[1] \"\"\n\n",
            "#: .\\\\weapons.json\n",
            "msgid \"prototype rifle\"\n",
            "msgid_plural \"prototype rifles\"\n",
            "msgstr[0] \"\"\n",
            "msgstr[1] \"\"\n\n",
            "#: .\\\\other.json\n",
            "msgid \"plain entry\"\n",
            "msgid_plural \"plain entrys\"\n",
            "msgstr[0] \"\"\n",
            "msgstr[1] \"\"\n"
        );
        let candidates = HashSet::from([String::from("mad doctor"), String::from("prototype rifle")]);

        let rewritten = apply_plural_override_to_pot_text(content, &candidates);

        assert!(rewritten.contains("msgid_plural \"mad doctor\""));
        assert!(rewritten.contains("msgid_plural \"prototype rifle\""));
        assert!(rewritten.contains("msgid_plural \"plain entrys\""));
    }

    #[test]
    fn formats_transport_error_with_category_and_causes() {
        let message = format_transport_error_message(
            "OpenAI compatible request failed",
            "siliconflow",
            "https://api.siliconflow.cn/v1/chat/completions",
            1,
            4096,
            "connect",
            "error sending request for url",
            &["tcp connect error".to_string(), "connection reset by peer".to_string()],
        );

        assert!(message.contains("OpenAI compatible request failed [connect]"));
        assert!(message.contains("provider=siliconflow"));
        assert!(message.contains("segments=1"));
        assert!(message.contains("body_bytes=4096"));
        assert!(message.contains("connection reset by peer"));
    }

    #[test]
    fn build_cbn_extract_args_keeps_output_flag() {
        let script = Path::new("E:\\temp\\lang\\extract_json_strings.py");
        let args = build_cbn_extract_args(script, &[String::from("bad.json")]);

        assert_eq!(
            args,
            vec![
                "E:\\temp\\lang\\extract_json_strings.py".to_string(),
                "-i".to_string(),
                ".\\".to_string(),
                "-o".to_string(),
                "lang\\extracted_strings.pot".to_string(),
                "-e".to_string(),
                "bad.json".to_string(),
            ]
        );
    }

    #[test]
    fn build_cdda_extract_args_uses_reference_flag() {
        let args = build_cdda_extract_args(&[String::from("bad.json")]);

        assert_eq!(
            args,
            vec![
                "-i".to_string(),
                ".\\".to_string(),
                "-r".to_string(),
                "lang\\extracted_strings.pot".to_string(),
                "-X".to_string(),
                "bad.json".to_string(),
            ]
        );
    }

    #[test]
    fn ensure_cdda_reference_pot_creates_missing_file() {
        let temp_root = std::env::temp_dir().join(format!(
            "cataclysm_translator_refpot_{}",
            std::process::id()
        ));
        let reference = temp_root.join("lang").join("extracted_strings.pot");
        let _ = fs::remove_dir_all(&temp_root);

        ensure_cdda_reference_pot(&reference).unwrap();

        assert!(reference.exists());
        let content = fs::read_to_string(&reference).unwrap();
        assert_eq!(content, "");

        let _ = fs::remove_dir_all(&temp_root);
    }

    #[test]
    fn lang_mo_file_keeps_cbn_layout() {
        let path = lang_mo_file("E:\\mods\\demo", "zh_CN", "cbn", "demo");
        assert_eq!(path, PathBuf::from("E:\\mods\\demo\\lang\\zh_CN.mo"));
    }

    #[test]
    fn lang_mo_file_uses_cdda_layout() {
        let path = lang_mo_file("E:\\mods\\demo", "zh_CN", "cdda", "demo");
        assert_eq!(
            path,
            PathBuf::from("E:\\mods\\demo\\lang\\mo\\zh_CN\\LC_MESSAGES\\demo.mo")
        );
    }

    #[test]
    fn read_mod_id_from_modinfo_uses_first_id() {
        let temp_root = std::env::temp_dir().join(format!(
            "cataclysm_translator_modinfo_{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&temp_root);
        fs::create_dir_all(&temp_root).unwrap();
        fs::write(
            temp_root.join("modinfo.json"),
            r#"[{"type":"MOD_INFO","id":"demo_mod","name":"Demo Mod"}]"#,
        )
        .unwrap();

        let id = read_mod_id_from_modinfo(temp_root.to_string_lossy().as_ref()).unwrap();

        assert_eq!(id, "demo_mod");
        let _ = fs::remove_dir_all(&temp_root);
    }

    #[test]
    fn scan_files_reports_readable_missing_directory_error() {
        let missing = std::env::temp_dir().join(format!(
            "cataclysm_translator_missing_dir_{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&missing);

        let error = scan_files(missing.to_string_lossy().as_ref()).unwrap_err();

        assert!(error.contains("目录不存在"));
    }

    #[test]
    fn run_cmd_reports_readable_process_errors() {
        let error = run_cmd(Path::new("Z:\\definitely-missing-tool.exe"), &[]).unwrap_err();

        assert!(error.contains("命令执行失败"));
    }

    #[test]
    fn lang_extract_po_segments_reports_readable_missing_po_error() {
        let config = LangWorkflowConfig {
            lang_dir: String::new(),
            lang_mode: Some(String::from("cbn")),
            mod_dir: String::from("E:\\mods\\demo"),
            language: String::from("zh_CN"),
            no_str_pl_no_s: false,
            python_path: None,
            gettext_path: None,
        };

        let error = lang_extract_po_segments(config).unwrap_err();

        assert!(error.contains("PO 文件不存在"));
    }

    #[test]
    fn write_back_json_reports_readable_parse_error() {
        let error = write_back_json("{", &HashMap::new(), "broken.json").unwrap_err();

        assert!(error.contains("JSON 解析失败"));
    }

    #[test]
    fn parse_translation_response_reports_readable_json_error() {
        let error = parse_translation_response("not json", &[]).unwrap_err();

        assert!(error.contains("解析返回 JSON 失败"));
    }

    #[test]
    fn read_mod_id_from_modinfo_reports_readable_read_error() {
        let temp_root = std::env::temp_dir().join(format!(
            "cataclysm_translator_modinfo_read_error_{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&temp_root);
        fs::create_dir_all(temp_root.join("modinfo.json")).unwrap();

        let error = read_mod_id_from_modinfo(temp_root.to_string_lossy().as_ref()).unwrap_err();

        assert!(error.contains("读取 modinfo 失败"));
        let _ = fs::remove_dir_all(&temp_root);
    }

    #[test]
    fn lang_bridge_po_to_code_requires_output_dir_with_readable_error() {
        let config = LangWorkflowConfig {
            lang_dir: String::new(),
            lang_mode: Some(String::from("cbn")),
            mod_dir: String::from("E:\\mods\\demo"),
            language: String::from("zh_CN"),
            no_str_pl_no_s: false,
            python_path: None,
            gettext_path: None,
        };

        let error = lang_bridge_po_to_code(
            config,
            String::from("en"),
            String::from("zh_CN"),
            String::new(),
        )
        .unwrap_err();

        assert!(error.contains("输出目录不能为空"));
    }

    #[test]
    fn save_user_config_reports_readable_json_error() {
        let error = save_user_config(String::from("{")).unwrap_err();

        assert!(error.contains("用户配置 JSON 无效"));
    }

    #[test]
    fn extract_from_json_reports_readable_invalid_regex_error() {
        let rule = Rule {
            _format: None,
            include_keys: None,
            exclude_keys: None,
            include_key_regex: Some(String::from("(")),
            exclude_key_regex: None,
            include_path_regex: None,
            exclude_path_regex: None,
            skip_empty: None,
            regex: None,
        };

        let error = extract_from_json("{}", "test.json", &rule).unwrap_err();

        assert!(error.contains("includeKeyRegex 无效"));
    }
}

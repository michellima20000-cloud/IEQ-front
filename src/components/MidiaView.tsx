import React, { useState, useEffect, useRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Megaphone, Upload, ClipboardList, Calendar, Palette, ImagePlus,
  Check, Inbox, MapPin, Pencil, Trash2, RotateCcw, Youtube,
  CircleCheck, TriangleAlert, X, Download
} from 'lucide-react';
import { api, ApiClient } from '../api/client';

interface MediaItem {
  id: string;
  tipo: 'BANNER' | 'FOTO' | 'AVISO' | 'VIDEO';
  titulo: string;
  descricao?: string;
  url?: string;
  youtubeUrl?: string;
  status: 'RASCUNHO' | 'PENDENTE' | 'PUBLICADO' | 'DEVOLVIDO';
  comentarioPastor?: string;
  criadoEm: string;
}

interface Evento {
  id: string;
  titulo: string;
  descricao?: string;
  dataInicio: string;
  dataFim?: string;
  tipo: string;
  local?: string;
}

interface ConfigVisual {
  corPrimaria: string;
  corSecundaria: string;
  logoUrl?: string;
  layoutDivulgacao: string;
}

type Aba = 'uploads' | 'calendario' | 'visual' | 'status';

const STATUS_LABEL: Record<string, string> = {
  RASCUNHO: 'Rascunho',
  PENDENTE: 'Aguardando aprovação',
  PUBLICADO: 'Publicado',
  DEVOLVIDO: 'Devolvido pelo pastor',
};

const STATUS_COR: Record<string, string> = {
  RASCUNHO: 'badge-slate',
  PENDENTE: 'badge-amber',
  PUBLICADO: 'badge-emerald',
  DEVOLVIDO: 'badge-red',
};

function msgErro(err: any, fallback: string): string {
  return err?.response?.data?.message ?? err?.message ?? fallback;
}

function lerArquivoDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Redimensiona uma imagem para evitar uploads gigantes e manter as publicações
 * leves e consistentes. Não altera vídeos.
 */
function redimensionarImagem(file: File, maxWidth = 1920, qualidade = 0.85): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let largura = img.width;
      let altura = img.height;
      if (largura <= maxWidth) {
        resolve(file);
        return;
      }
      altura = Math.round((altura * maxWidth) / largura);
      largura = maxWidth;
      const canvas = document.createElement('canvas');
      canvas.width = largura;
      canvas.height = altura;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(file); return; }
      ctx.drawImage(img, 0, 0, largura, altura);
      canvas.toBlob(
        (blob) => {
          if (!blob) { resolve(file); return; }
          const nome = file.name.replace(/\.[^/.]+$/, '.jpg');
          const novoArquivo = new File([blob], nome, { type: 'image/jpeg', lastModified: Date.now() });
          resolve(novoArquivo);
        },
        'image/jpeg',
        qualidade
      );
    };
    img.onerror = () => reject(new Error('Falha ao processar a imagem.'));
    img.src = URL.createObjectURL(file);
  });
}

function isoParaDatetimeLocal(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function MidiaView() {
  const [aba, setAba] = useState<Aba>('uploads');
  const [midias, setMidias] = useState<MediaItem[]>([]);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [visual, setVisual] = useState<ConfigVisual | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');

  // Form upload
  const [uploadTipo, setUploadTipo] = useState<'BANNER' | 'FOTO' | 'AVISO' | 'VIDEO'>('BANNER');
  const [uploadTitulo, setUploadTitulo] = useState('');
  const [uploadDescricao, setUploadDescricao] = useState('');
  const [uploadArquivo, setUploadArquivo] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [arquivoInfo, setArquivoInfo] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Instalação PWA
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const appInstalado =
    typeof window !== 'undefined' &&
    window.matchMedia('(display-mode: standalone)').matches;

  useEffect(() => {
    const handler = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      // Só mostra o banner se ainda não estiver instalado e não for mobile com app instalado
      if (!appInstalado) setShowInstallBanner(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', () => {
      setShowInstallBanner(false);
      setDeferredPrompt(null);
    });
    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', () => {});
    };
  }, [appInstalado]);

  const instalarApp = () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then((resultado: any) => {
      if (resultado.outcome === 'accepted') {
        setShowInstallBanner(false);
        setDeferredPrompt(null);
      }
    });
  };
  const [uploadYoutube, setUploadYoutube] = useState('');
  const [uploadRequerAprovacao, setUploadRequerAprovacao] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Form evento
  const [eventoId, setEventoId] = useState<string | null>(null);
  const [eventoTitulo, setEventoTitulo] = useState('');
  const [eventoDesc, setEventoDesc] = useState('');
  const [eventoInicio, setEventoInicio] = useState('');
  const [eventoFim, setEventoFim] = useState('');
  const [eventoTipo, setEventoTipo] = useState('CULTO');
  const [eventoLocal, setEventoLocal] = useState('');

  // Form visual
  const [corPrimaria, setCorPrimaria] = useState('#2563eb');
  const [corSecundaria, setCorSecundaria] = useState('#f59e0b');
  const [layoutOpt, setLayoutOpt] = useState('GRID');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const logoRef = useRef<HTMLInputElement>(null);

  const limparMsg = () => { setErro(''); setSucesso(''); };

  useEffect(() => {
    if (aba === 'uploads' || aba === 'status') carregarMidias();
    if (aba === 'calendario') carregarEventos();
    if (aba === 'visual') carregarVisual();
  }, [aba]);

  async function carregarMidias() {
    setCarregando(true);
    try {
      const r = await api.get('/midia/minhas');
      const lista = r.data?.conteudos ?? r.data?.itens ?? r.data ?? [];
      // Mapeia campos do backend para a interface local
      setMidias(lista.map((m: any) => ({
        ...m,
        criadoEm: m.createdAt || m.criadoEm,
        youtubeUrl: m.videoUrl || m.youtubeUrl,
        url: m.arquivoUrl || m.url,
      })));
      setErro('');
    } catch {
      setErro('Não foi possível carregar as mídias.');
    } finally {
      setCarregando(false);
    }
  }

  async function carregarEventos() {
    setCarregando(true);
    try {
      const r = await api.get('/calendario');
      setEventos((r.data?.eventos ?? r.data ?? []).map((ev: any) => ({
        ...ev,
        dataInicio: ev.dataInicio || ev.inicio,
        dataFim: ev.dataFim || ev.fim,
      })));
      setErro('');
    } catch {
      setErro('Não foi possível carregar o calendário.');
    } finally {
      setCarregando(false);
    }
  }

  async function carregarVisual() {
    setCarregando(true);
    try {
      const r = await api.get('/configuracoes/visual');
      const cfg: ConfigVisual = r.data?.visual ?? r.data ?? { corPrimaria: '#2563eb', corSecundaria: '#f59e0b', layoutDivulgacao: 'GRID' };
      setVisual(cfg);
      setCorPrimaria(cfg.corPrimaria);
      setCorSecundaria(cfg.corSecundaria);
      setLayoutOpt(cfg.layoutDivulgacao || 'GRID');
    } catch {
      setErro('Não foi possível carregar as configurações visuais.');
    } finally {
      setCarregando(false);
    }
  }

  async function enviarMidia(e: React.FormEvent) {
    e.preventDefault();
    limparMsg();
    if (!uploadTitulo.trim()) { setErro('Informe o título.'); return; }
    if (uploadTipo === 'VIDEO' && !uploadYoutube && !uploadArquivo) {
      setErro('Informe o link do YouTube ou selecione um arquivo de vídeo (máx. 50 MB).'); return;
    }
    if ((uploadTipo === 'BANNER' || uploadTipo === 'FOTO') && !uploadArquivo) {
      setErro('Selecione um arquivo de imagem.'); return;
    }
    if (uploadArquivo && uploadArquivo.size > 50 * 1024 * 1024) {
      setErro('O arquivo excede o limite de 50 MB.'); return;
    }

    const token = ApiClient.getAccessToken();
    if (!token) { setErro('Sessão expirada. Faça login novamente.'); return; }

    let arquivoParaEnvio = uploadArquivo;
    if ((uploadTipo === 'BANNER' || uploadTipo === 'FOTO') && uploadArquivo?.type.startsWith('image/')) {
      try {
        arquivoParaEnvio = await redimensionarImagem(uploadArquivo, 1920, 0.85);
      } catch {
        // segue com o arquivo original se o processamento falhar
      }
    }

    const fd = new FormData();
    fd.append('tipo', uploadTipo);
    fd.append('titulo', uploadTitulo);
    if (uploadDescricao) fd.append('descricao', uploadDescricao);
    if (uploadYoutube) fd.append('videoUrl', uploadYoutube);
    fd.append('precisaAprovacao', String(uploadRequerAprovacao));
    if (arquivoParaEnvio) fd.append('arquivo', arquivoParaEnvio);

    const UPLOAD_TIMEOUT_MS = 180_000; // 3 minutos
    setCarregando(true);
    setUploadProgress(0);

    try {
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const tempoLimite = setTimeout(() => {
          xhr.abort();
          reject(new Error('O upload demorou mais que 3 minutos. Tente um arquivo menor ou verifique sua conexão.'));
        }, UPLOAD_TIMEOUT_MS);

        xhr.upload.addEventListener('progress', (ev) => {
          if (ev.lengthComputable) {
            setUploadProgress(Math.round((ev.loaded / ev.total) * 100));
          }
        });

        xhr.addEventListener('load', () => {
          clearTimeout(tempoLimite);
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(xhr.responseText);
          } else {
            let mensagem = 'Erro ao enviar a mídia.';
            try { mensagem = JSON.parse(xhr.responseText)?.message || mensagem; } catch { /* ignora */ }
            reject(new Error(mensagem));
          }
        });

        xhr.addEventListener('error', () => {
          clearTimeout(tempoLimite);
          reject(new Error('Falha de conexão ao enviar a mídia. Verifique sua internet.'));
        });

        xhr.addEventListener('abort', () => {
          clearTimeout(tempoLimite);
          reject(new Error('Upload cancelado.'));
        });

        xhr.open('POST', `${ApiClient['getBaseUrl']()}/midia`);
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.send(fd);
      });

      setSucesso('Mídia enviada com sucesso!');
      setUploadTitulo(''); setUploadDescricao(''); setUploadYoutube('');
      setUploadArquivo(null); setPreviewUrl(null); setArquivoInfo(null); setUploadProgress(0);
      if (fileRef.current) fileRef.current.value = '';
      await carregarMidias();
    } catch (err: any) {
      setUploadProgress(0);
      setErro(msgErro(err, 'Falha ao enviar a mídia. Verifique sua conexão e tente novamente.'));
    } finally {
      setCarregando(false);
      setUploadProgress(0);
    }
  }

  async function reenviarMidia(id: string) {
    limparMsg();
    setCarregando(true);
    try {
      await api.patch(`/midia/${id}`, { reenviarAprovacao: true });
      setSucesso('Mídia reenviada para aprovação.');
      await carregarMidias();
    } catch (err: any) {
      setErro(msgErro(err, 'Erro ao reenviar.'));
    } finally {
      setCarregando(false);
    }
  }

  async function salvarEvento(e: React.FormEvent) {
    e.preventDefault();
    limparMsg();
    if (!eventoTitulo.trim() || !eventoInicio) { setErro('Preencha título e data de início.'); return; }
    setCarregando(true);
    try {
      const payload = {
        titulo: eventoTitulo,
        descricao: eventoDesc || null,
        dataInicio: eventoInicio,
        dataFim: eventoFim || eventoInicio,
        tipo: eventoTipo,
        local: eventoLocal || null,
      };
      if (eventoId) await api.patch(`/calendario/${eventoId}`, payload);
      else await api.post('/calendario', payload);
      setSucesso(eventoId ? 'Evento atualizado!' : 'Evento criado!');
      limparEvento();
      await carregarEventos();
    } catch (err: any) {
      setErro(msgErro(err, 'Erro ao salvar evento.'));
    } finally {
      setCarregando(false);
    }
  }

  async function excluirEvento(id: string) {
    if (!window.confirm('Excluir este evento?')) return;
    limparMsg();
    setCarregando(true);
    try {
      await api.delete(`/calendario/${id}`);
      setSucesso('Evento excluído.');
      await carregarEventos();
    } catch (err: any) {
      setErro(msgErro(err, 'Erro ao excluir evento.'));
    } finally {
      setCarregando(false);
    }
  }

  function editarEvento(ev: Evento) {
    setEventoId(ev.id);
    setEventoTitulo(ev.titulo);
    setEventoDesc(ev.descricao ?? '');
    setEventoInicio(isoParaDatetimeLocal(ev.dataInicio));
    setEventoFim(isoParaDatetimeLocal(ev.dataFim));
    setEventoTipo(ev.tipo || 'OUTRO');
    setEventoLocal(ev.local ?? '');
  }

  function limparEvento() {
    setEventoId(null); setEventoTitulo(''); setEventoDesc('');
    setEventoInicio(''); setEventoFim(''); setEventoTipo('CULTO'); setEventoLocal('');
  }

  async function salvarVisual(e: React.FormEvent) {
    e.preventDefault();
    limparMsg();
    setCarregando(true);
    try {
      const payload: any = {
        corPrimaria,
        corSecundaria,
        layoutDivulgacao: layoutOpt,
      };
      if (logoFile) payload.logoUrl = await lerArquivoDataUrl(logoFile);
      await api.patch('/configuracoes/visual', payload);
      setSucesso('Configurações visuais salvas!');
      setLogoFile(null); if (logoRef.current) logoRef.current.value = '';
      await carregarVisual();
    } catch (err: any) {
      setErro(msgErro(err, 'Erro ao salvar configurações.'));
    } finally {
      setCarregando(false);
    }
  }

  const abas: { id: Aba; label: string; Icon: LucideIcon }[] = [
    { id: 'uploads', label: 'Enviar', Icon: Upload },
    { id: 'status', label: 'Status', Icon: ClipboardList },
    { id: 'calendario', label: 'Calendário', Icon: Calendar },
    { id: 'visual', label: 'Visual', Icon: Palette },
  ];

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Header da Mídia */}
      <div className="card card-pad relative overflow-hidden">
        <div className="absolute -top-24 -right-16 w-56 h-56 rounded-full bg-blue-600/15 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-20 -left-10 w-44 h-44 rounded-full bg-indigo-600/10 blur-3xl pointer-events-none" />
        <div className="relative">
          <span className="eyebrow flex items-center gap-1.5">
            <Megaphone size={12} />
            Equipe de Mídia
          </span>
          <h2 className="page-title mt-1.5">Mídia</h2>
          <p className="section-sub mt-1">
            Publique conteúdo, acompanhe aprovações e organize o calendário da igreja
          </p>
        </div>
      </div>

      {/* Botão discreto de instalação PWA */}
      {showInstallBanner && !appInstalado && (
        <div className="flex justify-end">
          <button
            onClick={instalarApp}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-blue-600/10 hover:bg-blue-600/20 border border-blue-500/30 rounded text-xs text-blue-400"
          >
            <Download size={14} className="shrink-0" />
            Instalar app
          </button>
        </div>
      )}

      <nav className="flex flex-wrap gap-2">
        {abas.map(a => (
          <button
            key={a.id}
            onClick={() => setAba(a.id)}
            className={`tab flex items-center gap-1.5 ${aba === a.id ? 'tab-active' : ''}`}
          >
            <a.Icon size={14} />
            {a.label}
          </button>
        ))}
      </nav>

      {/* Mensagens */}
      {erro && (
        <div className="alert-error">
          <span className="flex items-center gap-2 min-w-0">
            <TriangleAlert size={15} className="shrink-0" />
            <span>{erro}</span>
          </span>
        </div>
      )}
      {sucesso && (
        <div className="alert-success">
          <span className="flex items-center gap-2 min-w-0">
            <CircleCheck size={15} className="shrink-0" />
            <span>{sucesso}</span>
          </span>
        </div>
      )}

      {/* ABA: Enviar */}
      {aba === 'uploads' && (
        <form onSubmit={enviarMidia} className="card card-pad space-y-4">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center">
              <ImagePlus size={15} />
            </span>
            <h2 className="section-title">Nova Mídia</h2>
          </div>

          <div>
            <label className="label">Tipo</label>
            <select
              value={uploadTipo}
              onChange={e => setUploadTipo(e.target.value as any)}
              className="input"
            >
              <option value="BANNER">Banner</option>
              <option value="FOTO">Foto</option>
              <option value="AVISO">Aviso</option>
              <option value="VIDEO">Vídeo</option>
            </select>
          </div>

          <div>
            <label className="label">Título *</label>
            <input
              type="text"
              value={uploadTitulo}
              onChange={e => setUploadTitulo(e.target.value)}
              className="input"
              placeholder="Título da mídia"
            />
          </div>

          <div>
            <label className="label">Descrição</label>
            <textarea
              value={uploadDescricao}
              onChange={e => setUploadDescricao(e.target.value)}
              rows={3}
              className="input resize-none"
              placeholder="Descrição (opcional)"
            />
          </div>

          {uploadTipo === 'VIDEO' ? (
            <div className="space-y-3">
              <div>
                <label className="label">Link do YouTube (não listado)</label>
                <input
                  type="url"
                  value={uploadYoutube}
                  onChange={e => setUploadYoutube(e.target.value)}
                  className="input"
                  placeholder="https://www.youtube.com/watch?v=..."
                />
              </div>
              <p className="text-xs text-slate-500 text-center">— ou —</p>
              <div>
                <label className="label">Arquivo de vídeo (máx. 50 MB)</label>
                <input
                  ref={fileRef}
                  type="file"
                  accept="video/*"
                  onChange={e => setUploadArquivo(e.target.files?.[0] ?? null)}
                  className="input"
                />
              </div>
            </div>
          ) : (
            <div>
              <label className="label">Arquivo (imagem)</label>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={async (e) => {
                  const file = e.target.files?.[0] ?? null;
                  setUploadArquivo(file);
                  if (!file) { setPreviewUrl(null); setArquivoInfo(null); return; }
                  setPreviewUrl(URL.createObjectURL(file));
                  const img = new Image();
                  img.src = URL.createObjectURL(file);
                  img.onload = () => {
                    const kb = Math.round(file.size / 1024);
                    setArquivoInfo(`${img.width} × ${img.height} • ${kb} KB`);
                    URL.revokeObjectURL(img.src);
                  };
                }}
                className="input"
              />
              {previewUrl && (
                <div className="mt-2 relative rounded-xl overflow-hidden border border-slate-700 bg-slate-950">
                  <img src={previewUrl} alt="Pré-visualização" className="w-full h-48 object-cover" />
                  <button
                    type="button"
                    onClick={() => {
                      setUploadArquivo(null); setPreviewUrl(null); setArquivoInfo(null);
                      if (fileRef.current) fileRef.current.value = '';
                    }}
                    className="absolute top-2 right-2 bg-black/60 hover:bg-black/90 text-white rounded-full w-7 h-7 flex items-center justify-center"
                  >
                    <X size={14} />
                  </button>
                  {arquivoInfo && (
                    <div className="absolute bottom-2 left-2 bg-black/60 text-[11px] text-slate-300 px-2 py-1 rounded">
                      {arquivoInfo}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <label className="card-soft card-hover px-3.5 py-3 flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={uploadRequerAprovacao}
              onChange={e => setUploadRequerAprovacao(e.target.checked)}
              className="w-4 h-4 accent-blue-500"
            />
            <span className="text-sm text-slate-300">Requer aprovação do pastor antes de publicar</span>
          </label>

          <button
            type="submit"
            disabled={carregando}
            className="btn-primary w-full"
          >
            <Upload size={16} />
            {carregando ? 'Enviando...' : 'Enviar Mídia'}
          </button>

          {uploadProgress > 0 && uploadProgress < 100 && (
            <div className="mt-3">
              <div className="w-full bg-slate-800 rounded-full h-2">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all duration-100"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <div className="flex justify-between text-[11px] text-slate-400 mt-1">
                <span>Enviando arquivo...</span>
                <span>{uploadProgress}%</span>
              </div>
            </div>
          )}
        </form>
      )}

      {/* ABA: Status */}
      {aba === 'status' && (
        <section className="card card-pad">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center">
                <ClipboardList size={15} />
              </span>
              <h2 className="section-title">Minhas Mídias</h2>
            </div>
            {midias.length > 0 && <span className="badge-blue">{midias.length} mídias</span>}
          </div>

          {carregando && (
            <div className="loading-state">
              <div className="w-7 h-7 border-[3px] border-blue-500 border-t-transparent rounded-full animate-spin" />
              Carregando...
            </div>
          )}
          {!carregando && midias.length === 0 && (
            <div className="empty-state border-0 bg-transparent p-8">
              <Inbox size={22} className="block mx-auto mb-2 text-slate-600" />
              Nenhuma mídia enviada ainda.
            </div>
          )}

          <div className="space-y-3">
            {midias.map(m => (
              <div key={m.id} className="card-soft card-hover p-4 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-white">{m.titulo}</p>
                    <p className="text-xs text-slate-400 mt-1">{m.tipo} · {new Date(m.criadoEm).toLocaleDateString('pt-BR')}</p>
                  </div>
                  <span className={STATUS_COR[m.status]}>
                    {STATUS_LABEL[m.status]}
                  </span>
                </div>
                {m.status === 'DEVOLVIDO' && m.comentarioPastor && (
                  <div className="rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-xs text-red-300">
                    <p className="font-semibold mb-1 flex items-center gap-1.5">
                      <TriangleAlert size={12} />
                      Comentário do pastor:
                    </p>
                    <p>{m.comentarioPastor}</p>
                  </div>
                )}
                {m.status === 'DEVOLVIDO' && (
                  <button
                    onClick={() => reenviarMidia(m.id)}
                    disabled={carregando}
                    className="btn-soft-success btn-sm w-full"
                  >
                    <RotateCcw size={13} />
                    Corrigir e Reenviar para Aprovação
                  </button>
                )}
                {m.youtubeUrl && (
                  <a
                    href={m.youtubeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-400 hover:text-blue-300 underline"
                  >
                    <Youtube size={13} />
                    Ver vídeo no YouTube
                  </a>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ABA: Calendário */}
      {aba === 'calendario' && (
        <div className="space-y-5">
          <form onSubmit={salvarEvento} className="card card-pad space-y-4">
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center">
                <Calendar size={15} />
              </span>
              <h2 className="section-title">{eventoId ? 'Editar Evento' : 'Novo Evento'}</h2>
            </div>

            <div>
              <label className="label">Tipo</label>
              <select
                value={eventoTipo}
                onChange={e => setEventoTipo(e.target.value)}
                className="input"
              >
                <option value="CULTO">Culto</option>
                <option value="CONFERENCIA">Conferência</option>
                <option value="REUNIAO">Reunião</option>
                <option value="DATA_ESPECIAL">Data Especial</option>
                <option value="OUTRO">Outro</option>
              </select>
            </div>

            <div>
              <label className="label">Título *</label>
              <input
                type="text"
                value={eventoTitulo}
                onChange={e => setEventoTitulo(e.target.value)}
                className="input"
                placeholder="Nome do evento"
              />
            </div>

            <div>
              <label className="label">Descrição</label>
              <textarea
                value={eventoDesc}
                onChange={e => setEventoDesc(e.target.value)}
                rows={2}
                className="input resize-none"
              />
            </div>

            <div>
              <label className="label">Local</label>
              <input
                type="text"
                value={eventoLocal}
                onChange={e => setEventoLocal(e.target.value)}
                className="input"
                placeholder="Ex.: Templo principal, Online..."
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Início *</label>
                <input
                  type="datetime-local"
                  value={eventoInicio}
                  onChange={e => setEventoInicio(e.target.value)}
                  className="input"
                />
              </div>
              <div>
                <label className="label">Fim</label>
                <input
                  type="datetime-local"
                  value={eventoFim}
                  onChange={e => setEventoFim(e.target.value)}
                  className="input"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={carregando}
                className="btn-primary flex-1"
              >
                <Check size={16} />
                {carregando ? 'Salvando...' : (eventoId ? 'Atualizar' : 'Criar Evento')}
              </button>
              {eventoId && (
                <button type="button" onClick={limparEvento} className="btn-ghost">
                  Cancelar
                </button>
              )}
            </div>
          </form>

          <section className="card card-pad">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center">
                  <Calendar size={15} />
                </span>
                <h3 className="section-title">Próximos Eventos</h3>
              </div>
              {eventos.length > 0 && <span className="badge-blue">{eventos.length} eventos</span>}
            </div>

            {carregando && (
              <div className="loading-state">
                <div className="w-7 h-7 border-[3px] border-blue-500 border-t-transparent rounded-full animate-spin" />
                Carregando...
              </div>
            )}
            {!carregando && eventos.length === 0 && (
              <div className="empty-state border-0 bg-transparent p-8">
                <Calendar size={22} className="block mx-auto mb-2 text-slate-600" />
                Nenhum evento cadastrado.
              </div>
            )}

            <div className="space-y-3">
              {eventos.map(ev => (
                <div key={ev.id} className="card-soft card-hover p-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-white">{ev.titulo}</p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400 mt-1">
                      <span>{ev.tipo}</span>
                      <span className="flex items-center gap-1.5">
                        <Calendar size={11} className="text-blue-400" />
                        {new Date(ev.dataInicio).toLocaleString('pt-BR')}
                      </span>
                      {ev.local && (
                        <span className="flex items-center gap-1.5">
                          <MapPin size={11} className="text-emerald-400" />
                          {ev.local}
                        </span>
                      )}
                    </div>
                    {ev.descricao && <p className="text-xs text-slate-400 mt-1">{ev.descricao}</p>}
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    <button
                      onClick={() => editarEvento(ev)}
                      className="btn-ghost btn-sm"
                    >
                      <Pencil size={12} />
                      Editar
                    </button>
                    <button
                      onClick={() => excluirEvento(ev.id)}
                      className="btn-soft-danger btn-sm"
                    >
                      <Trash2 size={12} />
                      Excluir
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* ABA: Visual */}
      {aba === 'visual' && (
        <form onSubmit={salvarVisual} className="card card-pad space-y-4">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center">
              <Palette size={15} />
            </span>
            <h2 className="section-title">Personalização Visual</h2>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Cor Primária</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={corPrimaria}
                  onChange={e => setCorPrimaria(e.target.value)}
                  className="w-10 h-10 rounded-lg border border-slate-700/70 bg-slate-950/80 cursor-pointer p-1"
                />
                <span className="text-xs text-slate-400 font-mono">{corPrimaria}</span>
              </div>
            </div>
            <div>
              <label className="label">Cor Secundária</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={corSecundaria}
                  onChange={e => setCorSecundaria(e.target.value)}
                  className="w-10 h-10 rounded-lg border border-slate-700/70 bg-slate-950/80 cursor-pointer p-1"
                />
                <span className="text-xs text-slate-400 font-mono">{corSecundaria}</span>
              </div>
            </div>
          </div>

          <div>
            <label className="label">Layout das telas de divulgação</label>
            <select
              value={layoutOpt}
              onChange={e => setLayoutOpt(e.target.value)}
              className="input"
            >
              <option value="GRID">Grade</option>
              <option value="CARROSSEL">Carrossel</option>
              <option value="LISTA">Lista</option>
            </select>
          </div>

          <div>
            <label className="label">Logo da Igreja</label>
            {visual?.logoUrl && (
              <img src={visual.logoUrl} alt="Logo atual" className="h-14 mb-2 rounded-xl border border-slate-700/70" />
            )}
            <input
              ref={logoRef}
              type="file"
              accept="image/*"
              onChange={e => setLogoFile(e.target.files?.[0] ?? null)}
              className="input"
            />
          </div>

          {/* Preview das cores */}
          <div className="rounded-xl overflow-hidden border border-slate-700/70">
            <div className="p-3 text-white text-sm font-semibold text-center" style={{ backgroundColor: corPrimaria }}>
              Exemplo de Cabeçalho
            </div>
            <div className="p-3 text-white text-xs text-center" style={{ backgroundColor: corSecundaria }}>
              Área de conteúdo
            </div>
          </div>

          <button
            type="submit"
            disabled={carregando}
            className="btn-primary w-full"
          >
            <Check size={16} />
            {carregando ? 'Salvando...' : 'Salvar Configurações Visuais'}
          </button>
        </form>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Paperclip, Plus, Search, Send, Users } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { createGroupChat, ensureDirectChat, sendAnnouncement } from "@/lib/actions/chat";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/field";
import { canAnnounce } from "@/lib/permissions";
import { cn, firstOf, formatBytes, relativeTime, sanitizeSearch } from "@/lib/utils";
import type { ChatMessage, ChatSummary, RoleName } from "@/lib/types";

export type Person = { id: string; full_name: string; avatar_url: string | null; department: string | null };

const PAGE = 50;
const MAX_FILE = 10 * 1024 * 1024;
const MESSAGE_SELECT = "*, sender:profiles!chat_messages_sender_id_fkey(full_name, avatar_url)";

type Msg = ChatMessage;
type Hit = { id: string; chat_id: string; body: string | null; created_at: string };

function withSender(row: Record<string, unknown>): Msg {
  const sender = firstOf(row.sender as Msg["sender"] | Msg["sender"][] | undefined);
  return { ...(row as unknown as Msg), sender };
}

export function ChatShell({
  meId,
  role,
  chats: initialChats,
  people,
}: {
  meId: string;
  role: string;
  chats: ChatSummary[];
  people: Person[];
}) {
  const params = useSearchParams();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  const [chats, setChats] = useState(initialChats);
  useEffect(() => setChats(initialChats), [initialChats]);

  // Only a room the person explicitly opened counts as read; never auto-open the newest one
  // (on mobile the thread is not even visible until a room is chosen).
  const requested = params.get("c");
  const activeId = requested;
  const active = chats.find((c) => c.id === activeId) ?? null;
  const canPost = active ? active.type !== "announcement" || canAnnounce(role as RoleName) : false;

  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [peerReadAt, setPeerReadAt] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [emailAll, setEmailAll] = useState(false);
  const [roomFilter, setRoomFilter] = useState("");
  const [threadFilter, setThreadFilter] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [showGroup, setShowGroup] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupMembers, setGroupMembers] = useState<string[]>([]);

  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const activeRef = useRef(activeId);
  activeRef.current = activeId;

  const markRead = useCallback(
    async (chatId: string) => {
      setChats((cur) => cur.map((c) => (c.id === chatId && c.unread ? { ...c, unread: 0 } : c)));
      await supabase.rpc("mark_chat_read", { p_chat: chatId });
    },
    [supabase]
  );

  const loadPeer = useCallback(
    async (chatId: string) => {
      const { data } = await supabase
        .from("chat_participants")
        .select("user_id, last_read_at")
        .eq("chat_id", chatId)
        .neq("user_id", meId);
      setPeerReadAt(data?.length === 1 ? (data[0].last_read_at as string) : null);
    },
    [supabase, meId]
  );

  // Load the newest page of messages whenever the room changes.
  useEffect(() => {
    if (!activeId) return;
    let ignore = false;
    setLoading(true);
    setMessages([]);
    setThreadFilter("");
    stickToBottom.current = true;
    (async () => {
      const { data, error } = await supabase
        .from("chat_messages")
        .select(MESSAGE_SELECT)
        .eq("chat_id", activeId)
        .order("created_at", { ascending: false })
        .limit(PAGE);
      if (ignore) return;
      if (error) toast.error("Could not load messages");
      setMessages((data ?? []).map(withSender).reverse());
      setHasMore((data?.length ?? 0) === PAGE);
      setLoading(false);
      markRead(activeId);
      loadPeer(activeId);
    })();
    return () => {
      ignore = true;
    };
  }, [activeId, supabase, markRead, loadPeer]);

  // One realtime subscription for every room this person can read (RLS filters the stream).
  useEffect(() => {
    const channel = supabase
      .channel(`chat-stream:${meId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, (payload) => {
        const row = payload.new as Msg;
        const mine = row.sender_id === meId;
        const preview = row.body?.trim() || row.file_name || "Attachment";
        const sender = peopleById.get(row.sender_id);

        setChats((cur) => {
          if (!cur.some((c) => c.id === row.chat_id)) return cur;
          return cur
            .map((c) =>
              c.id === row.chat_id
                ? {
                    ...c,
                    last_message: preview,
                    last_message_at: row.created_at,
                    unread: !mine && row.chat_id !== activeRef.current ? c.unread + 1 : c.unread,
                  }
                : c
            )
            .sort((a, b) => (b.last_message_at ?? b.created_at).localeCompare(a.last_message_at ?? a.created_at));
        });

        // A room we have not seen yet (someone started a conversation with us).
        setChats((cur) => {
          if (!cur.some((c) => c.id === row.chat_id)) router.refresh();
          return cur;
        });

        if (row.chat_id === activeRef.current) {
          setMessages((cur) =>
            cur.some((m) => m.id === row.id)
              ? cur
              : [
                  ...cur,
                  { ...row, sender: sender ? { full_name: sender.full_name, avatar_url: sender.avatar_url } : undefined },
                ]
          );
          if (!mine) {
            markRead(row.chat_id);
            loadPeer(row.chat_id);
          }
        }
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, meId, peopleById, router, markRead, loadPeer]);

  useEffect(() => {
    if (stickToBottom.current) scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages.length]);

  async function loadEarlier() {
    if (!activeId || !messages.length) return;
    stickToBottom.current = false;
    const { data } = await supabase
      .from("chat_messages")
      .select(MESSAGE_SELECT)
      .eq("chat_id", activeId)
      .lt("created_at", messages[0].created_at)
      .order("created_at", { ascending: false })
      .limit(PAGE);
    setMessages((cur) => [...(data ?? []).map(withSender).reverse(), ...cur]);
    setHasMore((data?.length ?? 0) === PAGE);
  }

  async function submit() {
    const text = draft.trim();
    if (!activeId || !active || !text || sending) return;
    if (text.length > 4000) {
      toast.error("Messages are limited to 4000 characters");
      return;
    }
    setSending(true);
    stickToBottom.current = true;
    try {
      if (active.type === "announcement") {
        const res = await sendAnnouncement(text, { email: emailAll });
        if ("error" in res && res.error) throw new Error(res.error);
        if ("emailed" in res && res.emailed) toast.success(`Announcement emailed to ${res.emailed} people`);
        setEmailAll(false);
      } else {
        const { data, error } = await supabase
          .from("chat_messages")
          .insert({ chat_id: activeId, sender_id: meId, body: text })
          .select(MESSAGE_SELECT)
          .single();
        if (error) throw new Error(error.message);
        setMessages((cur) => (cur.some((m) => m.id === data.id) ? cur : [...cur, withSender(data)]));
      }
      setDraft("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Message not sent");
    } finally {
      setSending(false);
    }
  }

  async function upload(file: File) {
    if (!activeId || !canPost) return;
    if (file.size > MAX_FILE) {
      toast.error(`Files are limited to ${formatBytes(MAX_FILE)}`);
      return;
    }
    const safeName = file.name.replace(/[^\w.\- ]+/g, "_").slice(0, 120);
    const path = `${activeId}/${crypto.randomUUID()}-${safeName}`;
    const toastId = toast.loading(`Uploading ${file.name}`);
    const { error: upError } = await supabase.storage.from("chat-files").upload(path, file);
    if (upError) {
      toast.error(upError.message, { id: toastId });
      return;
    }
    const { data, error } = await supabase
      .from("chat_messages")
      .insert({ chat_id: activeId, sender_id: meId, file_path: path, file_name: file.name, file_size: file.size })
      .select(MESSAGE_SELECT)
      .single();
    if (error) {
      await supabase.storage.from("chat-files").remove([path]);
      toast.error(error.message, { id: toastId });
      return;
    }
    toast.success("File shared", { id: toastId });
    stickToBottom.current = true;
    setMessages((cur) => (cur.some((m) => m.id === data.id) ? cur : [...cur, withSender(data)]));
  }

  async function openFile(m: Msg) {
    if (!m.file_path) return;
    const { data, error } = await supabase.storage.from("chat-files").createSignedUrl(m.file_path, 60);
    if (error || !data) {
      toast.error("You no longer have access to this file");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  // Search across every room this person can read.
  useEffect(() => {
    const term = sanitizeSearch(searchTerm);
    if (term.length < 2) {
      setHits(null);
      return;
    }
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from("chat_messages")
        .select("id, chat_id, body, created_at")
        .ilike("body", `%${term}%`)
        .order("created_at", { ascending: false })
        .limit(15);
      setHits((data ?? []) as Hit[]);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm, supabase]);

  async function startDirect(userId: string) {
    if (!userId) return;
    const res = await ensureDirectChat(userId);
    if ("chatId" in res && res.chatId) {
      router.push(`/chat?c=${res.chatId}`);
      router.refresh();
    } else if ("error" in res) toast.error(res.error);
  }

  async function makeGroup() {
    const res = await createGroupChat(groupName, groupMembers);
    if ("chatId" in res && res.chatId) {
      setShowGroup(false);
      setGroupName("");
      setGroupMembers([]);
      router.push(`/chat?c=${res.chatId}`);
      router.refresh();
    } else if ("error" in res) toast.error(res.error);
  }

  const shownMessages = threadFilter
    ? messages.filter((m) => (m.body ?? m.file_name ?? "").toLowerCase().includes(threadFilter.toLowerCase()))
    : messages;
  const visibleRooms = chats.filter((c) => !roomFilter || c.title.toLowerCase().includes(roomFilter.toLowerCase()));
  const lastMineId = [...messages].reverse().find((m) => m.sender_id === meId)?.id;
  const others = people.filter((p) => p.id !== meId);

  return (
    <div className="grid min-h-[calc(100vh-14rem)] grid-cols-1 overflow-hidden border border-line bg-panel lg:grid-cols-[320px_1fr]">
      <aside className={cn("flex min-h-0 flex-col border-line lg:border-r", requested ? "hidden lg:flex" : "flex")}>
        <div className="space-y-2 border-b border-line p-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <Input
              className="pl-8"
              placeholder="Search all messages"
              aria-label="Search all messages"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <Input
            placeholder="Filter rooms"
            aria-label="Filter rooms"
            value={roomFilter}
            onChange={(e) => setRoomFilter(e.target.value)}
          />
          <Select aria-label="Start a direct message" value="" onChange={(e) => startDirect(e.target.value)}>
            <option value="">New direct message…</option>
            {others.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
                {p.department ? ` · ${p.department}` : ""}
              </option>
            ))}
          </Select>
        </div>

        {hits ? (
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="flex items-center justify-between px-4 py-2 text-xs text-muted">
              <span>
                {hits.length} match{hits.length === 1 ? "" : "es"}
              </span>
              <button className="underline" onClick={() => setSearchTerm("")}>
                Clear
              </button>
            </div>
            <ul>
              {hits.map((h) => (
                <li key={h.id}>
                  <button
                    className="block w-full border-t border-line px-4 py-3 text-left text-sm hover:bg-paper"
                    onClick={() => {
                      setSearchTerm("");
                      router.push(`/chat?c=${h.chat_id}`);
                    }}
                  >
                    <span className="block truncate font-medium">
                      {chats.find((c) => c.id === h.chat_id)?.title ?? "Room"}
                    </span>
                    <span className="line-clamp-2 text-muted">{h.body}</span>
                    <span className="font-mono text-[11px] text-muted">{relativeTime(h.created_at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <ul className="min-h-0 flex-1 overflow-auto">
            {visibleRooms.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => router.push(`/chat?c=${c.id}`)}
                  aria-current={c.id === activeId}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 border-b border-line px-4 py-3 text-left text-sm hover:bg-paper",
                    c.id === activeId && "bg-paper"
                  )}
                >
                  <span className="min-w-0">
                    <span className={cn("block truncate", c.unread > 0 ? "font-semibold" : "font-medium")}>{c.title}</span>
                    <span className="block truncate text-xs text-muted">{c.last_message ?? c.type}</span>
                  </span>
                  {c.unread > 0 ? (
                    <span className="shrink-0 bg-copper px-1.5 font-mono text-[10px] text-white">{c.unread}</span>
                  ) : null}
                </button>
              </li>
            ))}
            {!visibleRooms.length ? <li className="px-4 py-6 text-sm text-muted">No rooms match.</li> : null}
          </ul>
        )}

        <div className="border-t border-line p-3">
          {showGroup ? (
            <div className="space-y-2">
              <Input
                placeholder="Group name"
                aria-label="Group name"
                maxLength={80}
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
              />
              <div className="max-h-32 space-y-1 overflow-auto border border-line p-2 text-sm">
                {others.map((p) => (
                  <label key={p.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={groupMembers.includes(p.id)}
                      onChange={() =>
                        setGroupMembers((cur) => (cur.includes(p.id) ? cur.filter((id) => id !== p.id) : [...cur, p.id]))
                      }
                    />
                    {p.full_name}
                  </label>
                ))}
              </div>
              <div className="flex gap-2">
                <Button size="sm" type="button" onClick={makeGroup}>
                  Create group
                </Button>
                <Button size="sm" variant="ghost" type="button" onClick={() => setShowGroup(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="ghost" type="button" className="w-full" onClick={() => setShowGroup(true)}>
              <Users size={14} /> New group
            </Button>
          )}
        </div>
      </aside>

      <section className={cn("min-h-[480px] min-w-0 flex-col", requested ? "flex" : "hidden lg:flex")}>
        {active ? (
          <>
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <button
                  className="p-1 lg:hidden"
                  aria-label="Back to rooms"
                  onClick={() => router.push("/chat")}
                >
                  <ArrowLeft size={18} />
                </button>
                <div className="min-w-0">
                  <h2 className="truncate font-medium">{active.title}</h2>
                  <p className="font-mono text-[11px] capitalize text-muted">{active.type}</p>
                </div>
              </div>
              <Input
                placeholder="Find in this chat"
                aria-label="Find in this chat"
                className="max-w-[14rem]"
                value={threadFilter}
                onChange={(e) => setThreadFilter(e.target.value)}
              />
            </header>

            <div
              ref={scroller}
              className="flex-1 space-y-3 overflow-auto p-4"
              onScroll={(e) => {
                const el = e.currentTarget;
                stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
              }}
            >
              {hasMore && !threadFilter ? (
                <div className="text-center">
                  <Button size="sm" variant="ghost" type="button" onClick={loadEarlier}>
                    Load earlier messages
                  </Button>
                </div>
              ) : null}
              {loading ? <p className="text-sm text-muted">Loading messages…</p> : null}
              {!loading && !shownMessages.length ? (
                <p className="text-sm text-muted">
                  {threadFilter ? "No messages match." : "No messages yet. Say hello."}
                </p>
              ) : null}
              {shownMessages.map((m) => {
                const mine = m.sender_id === meId;
                const name = m.sender?.full_name ?? peopleById.get(m.sender_id)?.full_name ?? "Former employee";
                return (
                  <div key={m.id} className={cn("flex gap-3", mine && "flex-row-reverse")}>
                    <Avatar name={name} src={m.sender?.avatar_url} size={32} />
                    <div className={cn("max-w-[75%] px-3 py-2", mine ? "bg-teal/10" : "bg-paper")}>
                      <p className="text-xs text-muted">
                        {mine ? "You" : name} · {relativeTime(m.created_at)}
                      </p>
                      {m.body ? <p className="whitespace-pre-wrap break-words text-sm">{m.body}</p> : null}
                      {m.file_path ? (
                        <button
                          type="button"
                          onClick={() => openFile(m)}
                          className="mt-1 inline-flex items-center gap-1 text-sm text-teal underline"
                        >
                          <Paperclip size={14} />
                          {m.file_name}
                          {m.file_size ? <span className="text-muted no-underline">({formatBytes(m.file_size)})</span> : null}
                        </button>
                      ) : null}
                      {mine && m.id === lastMineId && active.type === "direct" ? (
                        <p className="mt-1 text-right font-mono text-[10px] text-muted">
                          {peerReadAt && peerReadAt >= m.created_at ? "Seen" : "Delivered"}
                        </p>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>

            {canPost ? (
              <form
                className="flex flex-col gap-2 border-t border-line p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  submit();
                }}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <Textarea
                    className="min-h-16 flex-1"
                    value={draft}
                    maxLength={4000}
                    aria-label="Message"
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        submit();
                      }
                    }}
                    placeholder={active.type === "announcement" ? "Write an announcement" : "Write a message (Enter to send)"}
                  />
                  <div className="flex gap-2">
                    <label
                      className="inline-flex h-10 cursor-pointer items-center gap-1 border border-line px-3 text-sm hover:bg-paper"
                      title="Share a file (10 MB max)"
                    >
                      <Paperclip size={14} /> File
                      <input
                        type="file"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (file) upload(file);
                        }}
                      />
                    </label>
                    <Button type="submit" disabled={sending || !draft.trim()}>
                      <Send size={14} /> {sending ? "Sending…" : "Send"}
                    </Button>
                  </div>
                </div>
                {active.type === "announcement" ? (
                  <label className="flex items-center gap-2 text-xs text-muted">
                    <input type="checkbox" checked={emailAll} onChange={(e) => setEmailAll(e.target.checked)} />
                    Also email everyone (needs RESEND_API_KEY)
                  </label>
                ) : null}
              </form>
            ) : (
              <p className="border-t border-line px-4 py-3 text-sm text-muted">Only admins can post here.</p>
            )}
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted">
            <Plus size={20} />
            Pick a room, or start a direct message.
          </div>
        )}
      </section>
    </div>
  );
}

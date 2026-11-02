import {useState, useEffect, useRef, useCallback} from 'react'
import {useTranslation} from 'react-i18next'
import { motion, AnimatePresence } from 'motion/react'
import {supabase} from '../../lib/supabase'
import {useAuth} from '../../context/useAuth'
import {useConfirmModal} from '../../context/useConfirmModal'
import {useOnlyBartAccess, type OnlyBartAccess} from '../../hooks/useOnlyBartAccess'
import {FaHeart, FaRegHeart, FaComment, FaTrash, FaYoutube, FaImage, FaLock, FaStar} from 'react-icons/fa'
import './OnlyBartPage.css'
import siteConfig from '../../config/siteConfig'
import Footer from "../../components/Footer/Footer.tsx";

// Typen basierend auf DB-Schema
interface Post {
    id: string
    content: string
    media_url: string | null
    video_url: string | null
    type: 'text' | 'image' | 'video'
    created_at: string
    likes_count?: number
    comments_count?: number
    user_has_liked?: boolean
    user_has_superliked?: boolean
}

interface Comment {
    id: string
    post_id: string
    user_id: string
    content: string
    created_at: string
    display_name?: string // Per Join aus profiles geladen
}

interface Profile {
    id: string
    username: string
}

// ------------------------------------------------------------------
// Unter-Komponenten
// ------------------------------------------------------------------

function CreatePost({onSuccess}: { onSuccess: () => void }) {
    const {t} = useTranslation()
    const {showAlert, showPrompt} = useConfirmModal()
    const [content, setContent] = useState('')
    const [mediaFile, setMediaFile] = useState<File | null>(null)
    const [videoUrl, setVideoUrl] = useState('')
    const [loading, setLoading] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const handleSubmit = async () => {
        if (!content && !mediaFile && !videoUrl) return
        setLoading(true)

        try {
            let type = 'text'
            let uploadedMediaUrl = null

            if (mediaFile) {
                type = 'image'
                const fileExt = mediaFile.name.split('.').pop()
                const fileName = `${Math.random()}.${fileExt}`
                const {error: uploadError} = await supabase.storage
                    .from('onlybart-media')
                    .upload(fileName, mediaFile)

                if (uploadError) console.error(uploadError)

                const {data: publicUrlData} = supabase.storage
                    .from('onlybart-media')
                    .getPublicUrl(fileName)

                uploadedMediaUrl = publicUrlData.publicUrl
            } else if (videoUrl) {
                type = 'video'
            }

            const {error} = await supabase
                .schema('onlybart')
                .from('onlybart_posts')
                .insert({
                    content,
                    media_url: uploadedMediaUrl,
                    video_url: videoUrl,
                    type
                })

            if (error) console.error(error)

            setContent('')
            setMediaFile(null)
            setVideoUrl('')
            onSuccess()
        } catch (err) {
            console.error('Error creating post:', err)
            showAlert({
                title: t('confirmModal.errorTitle', 'Error'),
                message: t('onlybart.create.failedToPost', 'Failed to create post'),
                confirmLabel: t('confirmModal.ok', 'OK'),
            })
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="create-post-card">
      <textarea
          className="create-input"
          placeholder={t('onlybart.create.placeholder', 'What is on your mind?')}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={3}
      />

            {videoUrl && <div className="text-xs text-blue-400 mb-2">Video attached: {videoUrl}</div>}
            {mediaFile && <div className="text-xs text-green-400 mb-2">Image attached: {mediaFile.name}</div>}

            <div className="create-actions">
                <div className="flex gap-4">
                    <label className="media-upload-label flex items-center gap-2">
                        <FaImage/>
                        <input
                            type="file"
                            hidden
                            accept="image/*"
                            onChange={(e) => {
                                if (e.target.files?.[0]) {
                                    setMediaFile(e.target.files[0])
                                    setVideoUrl('') // Video leeren wenn Bild gewählt
                                }
                            }}
                            ref={fileInputRef}
                        />
                    </label>
                    <button
                        className="media-upload-label flex items-center gap-2 bg-transparent border-none"
                        onClick={async () => {
                            const url = await showPrompt({
                                title: t('onlybart.create.videoPromptTitle', 'YouTube Video'),
                                message: t('onlybart.create.videoPrompt', 'Enter unlisted YouTube URL:'),
                                inputPlaceholder: 'https://youtu.be/...',
                                confirmLabel: t('confirmModal.ok', 'OK'),
                                cancelLabel: t('confirmModal.cancel', 'Cancel'),
                            })
                            if (url) {
                                setVideoUrl(url)
                                setMediaFile(null) // Bild leeren wenn Video gewählt
                            }
                        }}
                    >
                        <FaYoutube/>
                    </button>
                </div>
                <button
                    className="submit-btn"
                    onClick={handleSubmit}
                    disabled={loading || (!content && !mediaFile && !videoUrl)}
                >
                    {loading ? t('common.loading', 'Posting...') : t('onlybart.create.submit', 'Post')}
                </button>
            </div>
        </div>
    )
}

function PostCard({post, access, onDelete, onLikeChange}: {
    post: Post,
    access: OnlyBartAccess,
    onDelete: (id: string) => void,
    onLikeChange?: () => void
}) {
    const {user} = useAuth()
    const {t} = useTranslation()
    const {showConfirm} = useConfirmModal()
    const [comments, setComments] = useState<Comment[]>([])
    const [showComments, setShowComments] = useState(false)
    const [newComment, setNewComment] = useState('')
    const [likesCount, setLikesCount] = useState(post.likes_count || 0)
    const [hasLiked, setHasLiked] = useState(post.user_has_liked || false)
    const [hasSuperliked, setHasSuperliked] = useState(post.user_has_superliked || false)
    const [commentsCount, setCommentsCount] = useState(post.comments_count || 0)
    const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setLightboxUrl(null)
        }
        document.addEventListener('keydown', handleKeyDown)
        return () => document.removeEventListener('keydown', handleKeyDown)
    }, [])

    const loadComments = useCallback(async () => {
        // 1. Kommentare laden (ohne Join)
        const {data: commentsData, count} = await supabase
            .schema('onlybart')
            .from('onlybart_comments')
            .select('*', {count: 'exact'})
            .eq('post_id', post.id)
            .order('created_at', {ascending: true})

        setCommentsCount(count || 0)

        if (!commentsData || commentsData.length === 0) {
            setComments([])
            return
        }

        // 2. Alle unique user_id extrahieren
        const userIds = Array.from(new Set(commentsData.map((c: Comment) => c.user_id)))

        // 3. Profile laden
        let profilesMap: Record<string, string> = {}
        if (userIds.length > 0) {
            const {data: profilesData} = await supabase
                .from('profiles')
                .select('id, username')
                .in('id', userIds)
            if (profilesData) {
                profilesMap = Object.fromEntries((profilesData as Profile[]).map((p: Profile) => [p.id, p.username]))
            }
        }

        // 4. display_name zuordnen
        const formatted: Comment[] = (commentsData as Comment[]).map((c: Comment) => ({
            ...c,
            display_name: profilesMap[c.user_id] || 'Unknown'
        }))
        setComments(formatted)
    }, [post.id])

    useEffect(() => {
        if (showComments) {
            // oxlint-disable-next-line react-compiler/set-state-in-effect
            loadComments()
        }
    }, [showComments, loadComments])

    // Echtzeit-Subscription für Kommentare
    useEffect(() => {
        const channel = supabase
            .channel(`comments-${post.id}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'onlybart_comments',
                    filter: `post_id=eq.${post.id}`
                },
                () => {
                    // Kommentare bei jeder Änderung neu laden
                    loadComments()
                }
            )
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [post.id, loadComments])

    const handleLike = async (isSuper = false) => {
        if (!access.canLike && !access.canSuperlike) return
        if (isSuper && !access.canSuperlike) return

        const currentlyLiked = hasLiked || hasSuperliked

        if (currentlyLiked) {
            // Abzugsmenge anhand des aktuellen Like-Typs bestimmen
            const currentValue = hasSuperliked ? 10 : 1

            // Prüfen ob Like-Typ gewechselt wird (Like → Superlike oder umgekehrt)
            const isSwitching = (isSuper && hasLiked) || (!isSuper && hasSuperliked)

            if (isSwitching) {
                // Wechsel: alten entfernen, neuen in einem Zug einfügen
                const newValue = isSuper ? 10 : 1
                setHasLiked(!isSuper)
                setHasSuperliked(isSuper)
                setLikesCount(prev => Math.max(0, prev - currentValue + newValue))

                // Alten Like löschen, neuen einfügen
                await supabase
                    .schema('onlybart')
                    .from('onlybart_likes')
                    .delete()
                    .match({post_id: post.id, user_id: user?.id})
                await supabase
                    .schema('onlybart')
                    .from('onlybart_likes')
                    .insert({
                        post_id: post.id,
                        user_id: user?.id,
                        is_superlike: isSuper
                    })
            } else {
                // Gleicher Button nochmal → Like entfernen
                setHasLiked(false)
                setHasSuperliked(false)
                setLikesCount(prev => Math.max(0, prev - currentValue))

                await supabase
                    .schema('onlybart')
                    .from('onlybart_likes')
                    .delete()
                    .match({post_id: post.id, user_id: user?.id})
            }
            if (onLikeChange) onLikeChange()
        } else {
            // Noch kein Like → neuen Like hinzufügen
            const addValue = isSuper ? 10 : 1
            if (isSuper) setHasSuperliked(true)
            else setHasLiked(true)
            setLikesCount(prev => prev + addValue)
            await supabase
                .schema('onlybart')
                .from('onlybart_likes')
                .insert({
                    post_id: post.id,
                    user_id: user?.id,
                    is_superlike: isSuper
                })
            if (onLikeChange) onLikeChange()
        }
    }

    const handleDeletePost = async () => {
        const confirmed = await showConfirm({
            title: t('confirmModal.deleteTitle', 'Confirm deletion'),
            message: t('onlybart.confirmDelete', 'Delete this post?'),
            confirmLabel: t('confirmModal.delete', 'Delete'),
            cancelLabel: t('confirmModal.cancel', 'Cancel'),
        })
        if (!confirmed) return
        onDelete(post.id)
        await supabase.schema('onlybart').from('onlybart_posts').delete().eq('id', post.id)
    }

    const handlePostComment = async () => {
        if (!newComment.trim()) return
        const {error} = await supabase.schema('onlybart').from('onlybart_comments').insert({
            post_id: post.id,
            user_id: user?.id,
            content: newComment
        })
        if (!error) {
            setNewComment('')
            setShowComments(true)
            setCommentsCount(prev => prev + 1)
            loadComments()
        }
    }

    const handleDeleteComment = async (commentId: string) => {
        const confirmed = await showConfirm({
            title: t('confirmModal.deleteTitle', 'Confirm deletion'),
            message: t('onlybart.confirmDeleteComment', 'Delete this comment?'),
            confirmLabel: t('confirmModal.delete', 'Delete'),
            cancelLabel: t('confirmModal.cancel', 'Cancel'),
        })
        if (!confirmed) return
        await supabase.schema('onlybart').from('onlybart_comments').delete().eq('id', commentId)
        setCommentsCount(prev => Math.max(0, prev - 1))
        loadComments()
    }

    // YouTube-ID aus URL extrahieren
    const getYoutubeId = (url: string) => {
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
        const match = url.match(regExp);
        return (match && match[2].length === 11) ? match[2] : null;
    }

    return (
        <div className="post-card">
            <div className="post-header">
                <div className="post-avatar">
                    <img src={siteConfig.onlyBart?.logoUrl || "/img/logo128.png"} alt="Avatar"
                         style={{width: '100%', height: '100%', borderRadius: '50%'}}/>
                </div>
                <div className="post-meta">
                    <span className="post-author">{siteConfig.onlyBart?.title || 'Posts'}</span>
                    <span className="post-date">{new Date(post.created_at).toLocaleDateString()}</span>
                </div>
                {access.canPost && (
                    <button onClick={handleDeletePost} className="ml-auto text-red-500"><FaTrash/></button>
                )}
            </div>

            <div className="post-content">
                {post.content}
            </div>

            {post.type === 'image' && post.media_url && (
                <button
                    className="post-media-btn"
                    onClick={() => setLightboxUrl(post.media_url)}
                    title={t('onlybart.image.viewFullSize', 'View full size')}
                >
                    <img src={post.media_url} alt="Post media" className="post-media"/>
                </button>
            )}

            {lightboxUrl && (
                <div
                    className="lightbox-backdrop"
                    onClick={() => setLightboxUrl(null)}
                    role="dialog"
                    aria-modal="true"
                    aria-label={t('onlybart.image.viewFullSize', 'View full size')}
                >
                    <button
                        className="lightbox-close"
                        onClick={() => setLightboxUrl(null)}
                        aria-label={t('onlybart.image.close', 'Close')}
                    >
                        ×
                    </button>
                    <img
                        src={lightboxUrl}
                        alt="Full size"
                        className="lightbox-img"
                        onClick={(e) => e.stopPropagation()}
                    />
                </div>
            )}

            {post.type === 'video' && post.video_url && (
                <div className="post-video">
                    <iframe
                        width="100%"
                        height="100%"
                        src={`https://www.youtube.com/embed/${getYoutubeId(post.video_url)}`}
                        title="YouTube video player"
                        style={{border: 0}}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                    ></iframe>
                </div>
            )}

            <div className="post-actions">
                {(!access.canLike && !access.canSuperlike) ? (
                    <div className="action-btn cursor-default" title="Only viewers can like">
                        <FaHeart/> {likesCount}
                    </div>
                ) : (
                    <>
                        <button
                            className={`action-btn ${hasLiked ? 'liked' : ''} ${hasSuperliked ? 'superliked' : ''}`}
                            onClick={() => handleLike(false)}
                            disabled={!access.canLike}
                        >
                            {hasLiked || hasSuperliked ? <FaHeart/> : <FaRegHeart/>}
                            {likesCount}
                        </button>
                        {access.canSuperlike && (
                            <button
                                className={`action-btn ${hasSuperliked ? 'superliked' : ''}`}
                                onClick={() => handleLike(true)}
                                title="Superlike (VIP)"
                            >
                                <FaStar/>
                            </button>
                        )}
                    </>
                )}

                <button className="action-btn" onClick={() => setShowComments(!showComments)}>
                    <FaComment/> {commentsCount > 0 ? commentsCount : ''}
                </button>
            </div>

            <AnimatePresence>
                {showComments && (
                    <motion.div
                        initial={{height: 0, opacity: 0}}
                        animate={{height: 'auto', opacity: 1}}
                        exit={{height: 0, opacity: 0}}
                        className="comments-section"
                    >
                        {comments.map(c => (
                            <div key={c.id} className="comment-item">
                                <div className="flex flex-col w-full">
                                    <span className="comment-author text-xs text-gray-400">{c.display_name}</span>
                                    <span className="text-sm">{c.content}</span>
                                </div>
                                {((user && user.id === c.user_id) || access.canDeleteComment) && (
                                    <button onClick={() => handleDeleteComment(c.id)} className="comment-delete">
                                        <FaTrash size={12}/>
                                    </button>
                                )}
                            </div>
                        ))}

                        {access.canComment && (
                            <div className="comment-form">
                                <input
                                    className="comment-input"
                                    value={newComment}
                                    onChange={(e) => setNewComment(e.target.value)}
                                    placeholder={t('onlybart.comment.placeholder')}
                                    onKeyDown={(e) => e.key === 'Enter' && handlePostComment()}
                                />
                                <button
                                    className="comment-send-btn"
                                    onClick={handlePostComment}
                                    disabled={!newComment.trim()}
                                    title={t('onlybart.comment.send', 'Send')}
                                >
                                    ⌲
                                </button>
                            </div>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}

// ------------------------------------------------------------------
// Haupt-Seite
// ------------------------------------------------------------------

/**
 * OnlyBart-Feed: zugriffsbeschraenkter Beitrags-Feed (nur Subs/VIPs/Mods) mit
 * Like-, Superlike- und Kommentarfunktion; Broadcaster koennen Beitraege erstellen.
 */
export function OnlyBartPage() {
    const {t} = useTranslation()
    const {user, signInWithTwitch} = useAuth()
    const access = useOnlyBartAccess()
    const [showIntro, setShowIntro] = useState(true)
    const [filter, setFilter] = useState<'all' | 'media' | 'photos' | 'videos'>('all')
    const [posts, setPosts] = useState<Post[]>([])

    // Intro-Splash nach 2s ausblenden.
    useEffect(() => {
        const timer = setTimeout(() => setShowIntro(false), 2000)
        return () => clearTimeout(timer)
    }, [])

    const fetchPosts = useCallback(async () => {
        if (!access.canView) return

        const {data, error} = await supabase
            .schema('onlybart')
            .from('onlybart_posts')
            .select('*, comments_count:onlybart_comments(count)')
            .order('created_at', {ascending: false})

        if (error) {
            console.error(error)
            return
        }

        if (data) {
            // Likes und Superlikes laden und zählen
            const enhancedPromise = data.map(async (p: Post) => {
                // Alle Likes für diesen Post laden
                const {data: likesData} = await supabase
                    .schema('onlybart')
                    .from('onlybart_likes')
                    .select('user_id, is_superlike')
                    .eq('post_id', p.id)

                // likes_count berechnen: Superlikes zählen als 10, normale als 1
                let likes_count = 0
                if (Array.isArray(likesData)) {
                    likes_count = likesData.reduce((sum, like) => sum + (like.is_superlike ? 10 : 1), 0)
                }

                // Prüfen, ob aktueller User geliked/supergeliked hat
                let myLike = null
                if (likesData && likesData.length > 0 && user && user.id) {
                    myLike = likesData.find(like => like.user_id === user.id)
                }

                // comments_count ist ein Array mit einem Objekt mit count
                let comments_count = 0
                if (Array.isArray(p.comments_count) && p.comments_count.length > 0) {
                    comments_count = p.comments_count[0].count || 0
                }

                return {
                    ...p,
                    likes_count,
                    user_has_liked: !!myLike && !myLike.is_superlike,
                    user_has_superliked: !!myLike && !!myLike.is_superlike,
                    comments_count
                }
            })

            const enhanced: Post[] = ((await Promise.all(enhancedPromise)) as unknown) as Post[]
            setPosts(enhanced)
        }
    }, [access.canView, user])

    useEffect(() => {
        if (access.canView && !showIntro) {
            // oxlint-disable-next-line react-compiler/set-state-in-effect
            fetchPosts()
        }
    }, [access.canView, showIntro, fetchPosts])

    const filteredPosts = posts.filter(post => {
        if (filter === 'all') return true
        if (filter === 'media') return post.type !== 'text'
        if (filter === 'photos') return post.type === 'image'
        if (filter === 'videos') return post.type === 'video'
        return true
    })

    // Zugriff verweigert anzeigen
    if (!access.loading && !access.canView && !showIntro) {
        if (!user) {
            return (
                <div className="onlybart-container">
                    <div className="access-denied">
                        <FaLock className="denied-icon"/>
                        <h2>{t('auth.loginRequired', 'Login Required')}</h2>
                        <p>{t('onlybart.notLoggedIn', 'Log in with Twitch to check if you have access to OnlyBart.')}</p>
                        <button className="btn btn-twitch mt-4" onClick={signInWithTwitch}>
                            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                                <path
                                    d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/>
                            </svg>
                            {t('auth.loginWithTwitch', 'Sign in with Twitch')}
                        </button>
                    </div>
                </div>
            )
        }
        return (
            <div className="onlybart-container">
                <div className="access-denied">
                    <FaLock className="denied-icon"/>
                    <h2>{t('onlybart.accessDenied.title', 'Access Restricted')}</h2>
                    <p>{t('onlybart.accessDenied.message', 'Only Subscribers, VIPs, and Mods have access to OnlyBart.')}</p>
                    <p className="text-gray-500 mt-4 text-sm">
                        {t('onlybart.accessDenied.subHint', 'If you are a subscriber, please ensure you are logged in with the correct account.')}
                    </p>
                </div>
            </div>
        )
    }

    return (
        <div className="onlybart-container">
            {showIntro && (
                <div className="onlybart-intro">
                    <img src={siteConfig.onlyBart?.logoUrl || "/img/logo128.png"} alt="Logo" className="intro-logo"/>
                </div>
            )}

            <div className="feed-layout">
                {/* Header / Filter */}
                <div className="flex justify-between items-center mb-6">
                    <div className="flex items-center gap-2">
                        <img
                            src={siteConfig.onlyBart?.logoUrl || "/img/logo128.png"}
                            alt="Logo"
                            className="ob-logo"
                        />
                        <h1 className="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-pink-600">
                            {siteConfig.onlyBart?.title || 'Posts'}
                        </h1>
                    </div>
                </div>

                <div className="filter-bar">
                    {['all', 'media', 'photos', 'videos'].map((f) => (
                        <button
                            key={f}
                            className={`filter-btn ${filter === f ? 'active' : ''}`}
                            onClick={() => setFilter(f as 'all' | 'media' | 'photos' | 'videos')}
                        >
                            {t(`onlybart.filter.${f}`, f.charAt(0).toUpperCase() + f.slice(1))}
                        </button>
                    ))}
                </div>

                {/* Beitrag erstellen (nur Broadcaster) */}
                {access.canPost && (
                    <CreatePost onSuccess={fetchPosts}/>
                )}

                {/* Feed */}
                {filteredPosts.length === 0 ? (
                    <div className="text-center text-gray-500 py-10">
                        {t('onlybart.noPosts', 'No posts yet. Be the first to see something amazing!')}
                    </div>
                ) : (
                    filteredPosts.map(post => (
                        <PostCard
                            key={post.id}
                            post={post}
                            access={access}
                            onDelete={(id) => setPosts(prev => prev.filter(p => p.id !== id))}
                            onLikeChange={fetchPosts}
                        />
                    ))
                )}
            </div>
            <Footer/>
        </div>
    )
}

export default OnlyBartPage

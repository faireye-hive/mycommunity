import { useState, useEffect, useRef } from 'react';
import { ExtendedComment } from './useComments';
import HiveClient from '@/lib/hive/hiveclient';

// Tipo para paginação da Bridge API (Apenas para o filtro 'all')
interface lastContainerInfo {
  permlink: string;
  author: string;
  date: string;
}

export type SnapFilterType = 'community' | 'all' | 'following';

interface UseSnapsProps {
  filterType?: SnapFilterType;
  username?: string; // Necessário quando filterType é 'following'
}

export const useSnaps = ({ filterType = 'community', username }: UseSnapsProps = {}) => {
  // Cursor para Bridge API (filtro 'all')
  const lastContainerRef = useRef<lastContainerInfo | null>(null);
  
  // Cursor para PeakD API (filtros 'following' e 'community') - ID numérico
  const lastIdRef = useRef<number | null>(null);
  
  const fetchedPermlinksRef = useRef<Set<string>>(new Set()); 

  const [currentPage, setCurrentPage] = useState(1);
  const [comments, setComments] = useState<ExtendedComment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [fetchTrigger, setFetchTrigger] = useState(0);

  const pageMinSize = 10;
  
  // Helper para chamar nosso Proxy interno e evitar CORS
  const fetchFromProxy = async (endpointType: 'feed' | 'tags', params: Record<string, string | number>) => {
    // Constrói a query string para o nosso proxy
    const query = new URLSearchParams({
        type: endpointType,
        ...params as any
    }).toString();

    // Chama a API local (/pages/api/peakd-proxy.ts)
    const response = await fetch(`/api/peakd-proxy?${query}`);
    
    if (!response.ok) {
        throw new Error(`Failed to fetch from Proxy (${endpointType})`);
    }
    
    return await response.json();
  }

  // Lógica 1: Buscar feed de seguidores via Proxy
  async function fetchFollowingFeed(): Promise<ExtendedComment[]> {
    if (!username) return [];

    const params: any = {
        container: 'peak.snaps',
        username: username,
        limit: pageMinSize
    };
    
    if (lastIdRef.current) {
        params.startId = lastIdRef.current;
    }

    // Usa o endpoint 'feed' via proxy
    const newSnaps: ExtendedComment[] = (await fetchFromProxy('feed', params)) as ExtendedComment[];

    if (newSnaps.length > 0) {
      lastIdRef.current = newSnaps[newSnaps.length - 1].id; 
    }

    return newSnaps;
  }

  // Lógica 2: Buscar feed da COMUNIDADE via Proxy
  async function fetchCommunityFeed(): Promise<ExtendedComment[]> {
    const tag = "hive-197333"; //|| process.env.NEXT_PUBLIC_HIVE_COMMUNITY_TAG;
    if (!tag) {
        console.warn("Community tag not defined");
        return [];
    }

    const params: any = {
        container: 'peak.snaps',
        tag: tag,
        limit: pageMinSize
    };

    if (lastIdRef.current) {
        params.startId = lastIdRef.current;
    }

    // Usa o endpoint 'tags' via proxy
    const newSnaps: ExtendedComment[] = (await fetchFromProxy('tags', params)) as ExtendedComment[];

    if (newSnaps.length > 0) {
      lastIdRef.current = newSnaps[newSnaps.length - 1].id; 
    }

    return newSnaps;
  }

  // Lógica 3: Buscar TUDO via Hive Bridge (Server-side call do HiveClient já evita CORS se configurado, ou é direto no blockchain que permite CORS)
  // Hive nodes geralmente permitem CORS, então mantemos direto.
  async function fetchHiveBridgeFeed(): Promise<ExtendedComment[]> {
    const containerAuthor = "peak.snaps";
    const limit = 2; 

    let startAuthor = lastContainerRef.current?.author || null;
    let startPermlink = lastContainerRef.current?.permlink || null;

    // 1. Busca os posts Contêineres
    const containerPosts = (await HiveClient.call('bridge','get_account_posts', [{
        account: containerAuthor,
        limit: limit,
        sort: "posts",
        start_author: startAuthor,
        start_permlink: startPermlink,
    }])) as any[];

    if (!containerPosts || containerPosts.length === 0) {
        return [];
    }

    // 2. Busca as respostas (Snaps) em paralelo
    const repliesPromises = containerPosts.map((container) => 
        HiveClient.database.call("get_content_replies", [
          container.author,
          container.permlink,
        ]).then((comments: any) => ({
             comments: comments as ExtendedComment[],
             parentPermlink: container.permlink,
             parentAuthor: container.author
        }))
    );

    const repliesResults = await Promise.all(repliesPromises);
    const allFilteredComments: ExtendedComment[] = [];

    // 3. Processa
    let lastProcessedItem: any | null = null;

    for (const { comments, parentPermlink, parentAuthor } of repliesResults) {
        allFilteredComments.push(...comments);
        fetchedPermlinksRef.current.add(parentPermlink);
        
        lastProcessedItem = { author: parentAuthor, permlink: parentPermlink };
    }

    // Atualiza o cursor
    if (lastProcessedItem) {
        lastContainerRef.current = { 
            author: lastProcessedItem.author, 
            permlink: lastProcessedItem.permlink, 
            date: new Date().toISOString() 
        };
    }

    return allFilteredComments;
  }

  // Função principal
  async function getMoreSnaps(): Promise<ExtendedComment[]> {
      if (filterType === 'following') {
          return await fetchFollowingFeed();
      } else if (filterType === 'community') {
          return await fetchCommunityFeed();
      } else {
          return await fetchHiveBridgeFeed();
      }
  }

  // Reset quando filtro muda
  useEffect(() => {
    lastContainerRef.current = null;
    lastIdRef.current = null;
    fetchedPermlinksRef.current.clear();
    setComments([]);
    setHasMore(true);
    setCurrentPage(1);
    setFetchTrigger(prev => prev + 1);
  }, [filterType, username]);

  // Busca posts quando currentPage muda
  useEffect(() => {
    const fetchPosts = async () => {
      setIsLoading(true);
      try {
        const newSnaps = await getMoreSnaps();

        if (newSnaps.length === 0 && (filterType === 'following' || filterType === 'community')) {
             setHasMore(false); 
        } 

        setComments((prevPosts) => {
          const existingPermlinks = new Set(prevPosts.map((post) => post.permlink));
          const uniqueSnaps = newSnaps.filter((snap) => !existingPermlinks.has(snap.permlink));
          return [...prevPosts, ...uniqueSnaps];
        });
      } catch (err) {
        console.error('Error fetching posts:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchPosts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, fetchTrigger]);

  // Load next page com throttling
  const loadNextPage = (() => {
    let isThrottled = false;
    return () => {
      if (!isLoading && hasMore && !isThrottled) {
        isThrottled = true;
        setCurrentPage((prevPage) => prevPage + 1);
        setTimeout(() => {
          isThrottled = false;
        }, 1000);
      }
    };
  })();

  return { comments, isLoading, loadNextPage, hasMore, currentPage };
};
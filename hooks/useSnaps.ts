import HiveClient from '@/lib/hive/hiveclient';
import { useState, useEffect, useRef } from 'react';
import { ExtendedComment } from './useComments';
import { getFollowing } from '@/lib/hive/client-functions';

interface lastContainerInfo {
  permlink: string;
  date: string;
}

type LastId = number | null; // Usar o ID retornado pela API
const lastIdRef = useRef<LastId>(null);

export type SnapFilterType = 'community' | 'all' | 'following';

interface UseSnapsProps {
  filterType?: SnapFilterType;
  username?: string; // Required when filterType is 'following'
}

export const useSnaps = ({ filterType = 'community', username }: UseSnapsProps = {}) => {
  const lastContainerRef = useRef<lastContainerInfo | null>(null); // Use useRef for last container
  const fetchedPermlinksRef = useRef<Set<string>>(new Set()); // Track fetched permlinks
  const followingListRef = useRef<string[]>([]); // Cache following list

  const [currentPage, setCurrentPage] = useState(1);
  const [comments, setComments] = useState<ExtendedComment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [followingListLoaded, setFollowingListLoaded] = useState(false);
  const [fetchTrigger, setFetchTrigger] = useState(0);

  const pageMinSize = 10;
  
  // Load following list once when needed
  useEffect(() => {
    const loadFollowingList = async () => {
      if (filterType === 'following' && username) {
        if (followingListRef.current.length === 0) {
          setFollowingListLoaded(false);
          try {
            const following = await getFollowing(username, '', 1000);
            followingListRef.current = following;
            setFollowingListLoaded(true);
            setFetchTrigger(prev => prev + 1); // Trigger fetch once list is loaded
          } catch (error) {
            console.error('Error loading following list:', error);
            setFollowingListLoaded(true); // Set to true even on error to prevent infinite loading
            setFetchTrigger(prev => prev + 1); // Trigger fetch anyway
          }
        } else {
          setFollowingListLoaded(true);
          setFetchTrigger(prev => prev + 1); // Trigger fetch since list already loaded
        }
      }
    };
    loadFollowingList();
  }, [filterType, username]);

  // Filter comments by the target tag
  function filterCommentsByTag(comments: ExtendedComment[], targetTag: string): ExtendedComment[] {
    return comments.filter((commentItem) => {
      try {
        if (!commentItem.json_metadata) {
          return false; // Skip if json_metadata is empty
        }
        const metadata = JSON.parse(commentItem.json_metadata);
        const tags = metadata.tags || [];
        return tags.includes(targetTag);
      } catch (error) {
        console.error('Error parsing JSON metadata for comment:', commentItem, error);
        return false; // Exclude comments with invalid JSON
      }
    });
  }

  // Filter comments by following
  function filterCommentsByFollowing(comments: ExtendedComment[]): ExtendedComment[] {
    return comments.filter((commentItem) => 
      followingListRef.current.includes(commentItem.author)
    );
  }

  // Fetch comments with a minimum size
async function getMoreSnaps(): Promise<ExtendedComment[]> {
  const container = 'peak.snaps';
  const limit = pageMinSize; // Use pageMinSize diretamente.
  
  let url = `https://peakd.com/api/public/snaps/feed?container=${container}&limit=${limit}`;

  // Se o filtro for 'following' e o username estiver disponível, passe o username.
  // IMPORTANTE: Assumimos que a PeakD API lida com o filtro 'following'
  if (filterType === 'following' && username) {
      url += `&username=${username}`; 
  }
  
  // Adiciona o cursor se não for a primeira página
  if (lastIdRef.current) {
    url += `&startId=${lastIdRef.current}`;
  }

  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error('Failed to fetch snaps from PeakD API');
  }

  // OTIMIZAÇÃO: A API PeakD retorna um array de objetos simplificados.
  // Você precisará mapear o retorno para o tipo 'ExtendedComment' se o seu componente
  // consumir esse formato. Se o formato for compatível, basta retornar o JSON.
  const newSnaps: ExtendedComment[] = (await response.json()) as ExtendedComment[];

  if (newSnaps.length > 0) {
    // Atualiza o cursor para o ID do último item retornado
    lastIdRef.current = newSnaps[newSnaps.length - 1].id; 
  }

  return newSnaps;
}

  // Reset when filter changes
  useEffect(() => {
    lastContainerRef.current = null;
    fetchedPermlinksRef.current.clear();
    setComments([]);
    setHasMore(true);
    setCurrentPage(1);
    setFetchTrigger(prev => prev + 1); // Trigger a new fetch
  }, [filterType, username]);

  // Fetch posts when `currentPage` changes (or when followingListLoaded changes for following filter)
  useEffect(() => {
    // Only wait for following list if we're on the following filter
    if (filterType === 'following') {
      if (!followingListLoaded) {
        return; // Wait for following list to load
      }
    }

    const fetchPosts = async () => {
      setIsLoading(true);
      try {
        const newSnaps = await getMoreSnaps();

        if (newSnaps.length < pageMinSize) {
          setHasMore(false); // No more items to fetch
        }

        // Avoid duplicates in the comments array
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

  // Load the next page with throttling
  const loadNextPage = (() => {
    let isThrottled = false;
    return () => {
      if (!isLoading && hasMore && !isThrottled) {
        isThrottled = true;
        setCurrentPage((prevPage) => prevPage + 1);
        // Throttle for 1 second
        setTimeout(() => {
          isThrottled = false;
        }, 1000);
      }
    };
  })();

  return { comments, isLoading, loadNextPage, hasMore, currentPage };
};

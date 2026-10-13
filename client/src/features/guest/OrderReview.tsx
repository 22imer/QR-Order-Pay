import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Star } from 'lucide-react';
import type { OrderReview as Review } from '@may-cafe/contracts';
import { api, getErrorCode, getErrorMessage, unwrap } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/useToast';

interface ReviewableOrder {
  _id: string;
  code: string;
  review: Review | null;
}

export function OrderReview({
  order,
  mode = 'active',
  onSubmitted,
}: {
  order: ReviewableOrder;
  mode?: 'active' | 'receipt';
  onSubmitted?: () => void;
}): JSX.Element {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState<Review | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['my-orders'] });
    void qc.invalidateQueries({ queryKey: ['receipt'] });
  };
  const review = useMutation({
    mutationFn: async (payload: { rating: number; comment: string }) =>
      unwrap<{ review: Review }>(
        await api.post(
          `/${mode === 'receipt' ? 'receipts/orders' : 'orders'}/${order._id}/review`,
          payload,
        ),
      ),
    onSuccess: (data, payload) => {
      const saved: Review = {
        ...payload,
        createdAt: data.review?.createdAt ?? new Date().toISOString(),
      };
      setSubmitted(saved);
      for (const key of ['my-orders', 'receipt']) {
        qc.setQueryData<{ orders: ReviewableOrder[] }>([key], (current) =>
          current
            ? {
                ...current,
                orders: current.orders.map((item) =>
                  item._id === order._id ? { ...item, review: saved } : item,
                ),
              }
            : current,
        );
      }
      refresh();
      toast({ title: 'Cảm ơn bạn đã đánh giá!', tone: 'success' });
      onSubmitted?.();
    },
    onError: (error) => {
      if (getErrorCode(error) === 'CONFLICT') refresh();
      toast({
        title: 'Chưa gửi được đánh giá',
        description: getErrorMessage(error),
        tone: 'danger',
      });
    },
  });
  const saved = order.review ?? submitted;
  if (saved)
    return (
      <div className="rounded-2xl border border-foreground/10 bg-card p-4">
        <p className="text-sm font-semibold">Đơn {order.code}</p>
        <p className="mt-1 flex items-center gap-2 text-sm">
          <span
            className="flex gap-0.5 text-accent"
            role="img"
            aria-label={`${saved.rating} trên 5 sao`}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <Star
                key={n}
                className={n <= saved.rating ? 'h-4 w-4 fill-current' : 'h-4 w-4 opacity-30'}
              />
            ))}
          </span>
          <span className="text-primary">Bạn đã đánh giá {saved.rating}/5 sao</span>
        </p>
        {saved.comment ? (
          <p className="mt-1 text-sm text-muted-foreground">“{saved.comment}”</p>
        ) : null}
      </div>
    );
  return (
    <form
      className="space-y-3 rounded-2xl border border-foreground/10 bg-card p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!review.isPending && !review.isSuccess)
          review.mutate({ rating, comment: comment.trim() });
      }}
    >
      <fieldset disabled={review.isPending || review.isSuccess} className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold">Đơn {order.code}</p>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Số sao</span>
            <select
              aria-label={`Số sao cho đơn ${order.code}`}
              value={rating}
              onChange={(event) => setRating(Number(event.target.value))}
              className="h-10 rounded-xl border border-foreground/15 bg-card px-3 text-sm font-semibold focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>
                  {n} sao
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block text-sm">
          Nhận xét (không bắt buộc)
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            maxLength={500}
            rows={2}
            className="mt-1.5 w-full rounded-2xl border border-foreground/15 bg-card p-3 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </label>
        <Button type="submit" disabled={review.isPending || review.isSuccess}>
          {review.isPending ? 'Đang gửi...' : 'Gửi đánh giá'}
        </Button>
      </fieldset>
    </form>
  );
}

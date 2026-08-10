import { ExternalLink, MapPin, Phone, X } from "lucide-react";
import type { RefObject } from "react";
import type { Place } from "../../shared/types";
import { googleMapsUrl } from "../lib/format";

type PlaceDetailSheetProps = {
  place?: Place;
  isLoading?: boolean;
  errorMessage?: string;
  onClose?: () => void;
  variant?: "default" | "compact";
  headingRef?: RefObject<HTMLHeadingElement>;
};

export function PlaceDetailSheet({
  place,
  isLoading = false,
  errorMessage,
  onClose,
  variant = "default",
  headingRef
}: PlaceDetailSheetProps) {
  const sheetClassName = `detail-sheet${variant === "compact" ? " detail-sheet--compact" : ""}`;

  if (isLoading) {
    return (
      <aside className={sheetClassName} aria-live="polite">
        <SheetTop onClose={onClose} />
        <p className="card-muted">詳細を読み込んでいます。</p>
      </aside>
    );
  }

  if (errorMessage) {
    return (
      <aside className={sheetClassName} aria-live="polite">
        <SheetTop onClose={onClose} />
        <p className="card-muted">{errorMessage}</p>
      </aside>
    );
  }

  if (!place) {
    return null;
  }

  const mapsUrl = googleMapsUrl(place);

  if (variant === "compact") {
    return (
      <aside className={sheetClassName}>
        <SheetTop onClose={onClose} />
        <div className="card-kicker">{place.categoryLabel}</div>
        <h2 ref={headingRef} tabIndex={-1}>{place.name}</h2>
        {place.address ? (
          <p className="card-line">
            <MapPin aria-hidden="true" size={16} />
            {place.address}
          </p>
        ) : null}
        <div className="sheet-actions">
          {place.phone ? (
            <a href={`tel:${place.phone}`} className="text-link">
              <Phone aria-hidden="true" size={15} />
              {place.phone}
            </a>
          ) : null}
          {mapsUrl ? (
            <a href={mapsUrl} target="_blank" rel="noreferrer" className="text-link">
              Google Maps
              <span className="sr-only">（新しいタブで開きます）</span>
              <ExternalLink aria-hidden="true" size={14} />
            </a>
          ) : null}
        </div>
      </aside>
    );
  }

  return (
    <aside className={sheetClassName}>
      <SheetTop onClose={onClose} />
      <div className="card-kicker">{place.categoryLabel}</div>
      <h2>{place.name}</h2>
      {place.address ? (
        <p className="card-line">
          <MapPin aria-hidden="true" size={16} />
          {place.address}
        </p>
      ) : null}
      {place.phone ? (
        <p className="card-line">
          <Phone aria-hidden="true" size={16} />
          <a href={`tel:${place.phone}`}>{place.phone}</a>
        </p>
      ) : null}
      <div className="sheet-actions">
        {mapsUrl ? (
          <a href={mapsUrl} target="_blank" rel="noreferrer" className="primary-link">
            Google Mapsで見る
            <span className="sr-only">（新しいタブで開きます）</span>
            <ExternalLink aria-hidden="true" size={16} />
          </a>
        ) : null}
        {place.officialUrl ? (
          <a href={place.officialUrl} target="_blank" rel="noreferrer" className="text-link">
            公式ページ
            <span className="sr-only">（新しいタブで開きます）</span>
            <ExternalLink aria-hidden="true" size={14} />
          </a>
        ) : null}
      </div>
    </aside>
  );
}

function SheetTop({ onClose }: { onClose?: () => void }) {
  if (!onClose) {
    return null;
  }

  return (
    <div className="detail-sheet__top">
      <button type="button" className="sheet-close" onClick={onClose} aria-label="閉じる">
        <X aria-hidden="true" size={18} />
      </button>
    </div>
  );
}

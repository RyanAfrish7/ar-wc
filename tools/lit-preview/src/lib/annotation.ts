import "reflect-metadata";

const previewMetadataKey = Symbol("preview");

export interface PreviewMetadata {
  title: string;
  propertyKey: string
}

export function preview(title: string) {
  return function (target: any, propertyKey: string) {
    const previewFnsMetadata: PreviewMetadata[] = Reflect.getOwnMetadata(previewMetadataKey, target) || [];
    previewFnsMetadata.push({
      title,
      propertyKey
    });

    Reflect.defineMetadata(previewMetadataKey, previewFnsMetadata, target);
  }
}

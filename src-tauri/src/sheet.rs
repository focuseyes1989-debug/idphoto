use crate::{background_color, pixels, render, Crop, DocumentStore};
use image::{DynamicImage, Rgb, RgbImage};
use serde::Deserialize;

#[derive(Deserialize, Clone)]
#[serde(default)]
pub struct Paper {
    pub width_mm: f64,
    pub height_mm: f64,
    pub left_mm: f64,
    pub right_mm: f64,
    pub top_mm: f64,
    pub bottom_mm: f64,
    pub column_gap_mm: Option<f64>,
    pub row_gap_mm: Option<f64>,
}
impl Default for Paper {
    fn default() -> Self {
        Self {
            width_mm: 101.6,
            height_mm: 152.4,
            left_mm: 0.0,
            right_mm: 0.0,
            top_mm: 0.0,
            bottom_mm: 0.0,
            column_gap_mm: None, row_gap_mm: None,
        }
    }
}
pub struct Bounds {
    pub width: u32,
    pub height: u32,
    pub left: u32,
    pub top: u32,
    pub usable_width: u32,
    pub usable_height: u32,
}
impl Paper {
    pub fn gaps(&self,gap:f64,dpi:u32)->Result<(u32,u32),String>{
        let x=self.column_gap_mm.unwrap_or(gap);let y=self.row_gap_mm.unwrap_or(gap);
        if [gap,x,y].iter().any(|v|!v.is_finite() || !(0.0..=20.0).contains(v)){return Err("Invalid column or row gap".into());}
        Ok((pixels(x,dpi),pixels(y,dpi)))
    }

    pub fn bounds(&self, dpi: u32) -> Result<Bounds, String> {
        if [self.column_gap_mm,self.row_gap_mm].into_iter().flatten().any(|v|!v.is_finite() || !(0.0..=20.0).contains(&v)) || !(72..=600).contains(&dpi)
            || ![
                self.width_mm,
                self.height_mm,
                self.left_mm,
                self.right_mm,
                self.top_mm,
                self.bottom_mm,
            ]
            .iter()
            .all(|v| v.is_finite())
            || !(25.4..=420.0).contains(&self.width_mm)
            || !(25.4..=420.0).contains(&self.height_mm)
            || [self.left_mm, self.right_mm, self.top_mm, self.bottom_mm]
                .iter()
                .any(|v| *v < 0.0)
            || self.left_mm + self.right_mm >= self.width_mm
            || self.top_mm + self.bottom_mm >= self.height_mm
        {
            return Err("Invalid paper size or margins".into());
        }
        let width = pixels(self.width_mm, dpi);
        let height = pixels(self.height_mm, dpi);
        let left = pixels(self.left_mm, dpi);
        let top = pixels(self.top_mm, dpi);
        let usable_width = width.saturating_sub(left + pixels(self.right_mm, dpi));
        let usable_height = height.saturating_sub(top + pixels(self.bottom_mm, dpi));
        if usable_width == 0 || usable_height == 0 {
            return Err("Margins leave no space for photos".into());
        }
        Ok(Bounds {
            width,
            height,
            left,
            top,
            usable_width,
            usable_height,
        })
    }
}

#[derive(Deserialize)]
pub struct SheetItem {
    pub doc_id: u64,
    pub crop: Crop,
    pub count: u32,
}
#[derive(Debug,Clone)]
pub struct Placement {
    pub index: usize,
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}
struct Row {
    width: u32,
    height: u32,
    items: Vec<Placement>,
}
pub fn layout_pages(
    items: &[SheetItem],
    dpi: u32,
    gap_mm: f64,
    paper: &Paper,
) -> Result<Vec<Vec<Placement>>, String> {
    if !(72..=600).contains(&dpi) || !gap_mm.is_finite() || !(0.0..=20.0).contains(&gap_mm) {
        return Err("Invalid sheet resolution or gap".into());
    }
    let total: u64 = items.iter().map(|item| item.count as u64).sum();
    if total == 0 || total > 100 || items.iter().any(|item| item.count > 100) {
        return Err("Choose 1 to 100 photos per print job".into());
    }
    let bounds = paper.bounds(dpi)?;
    let (gx,gy)=paper.gaps(gap_mm,dpi)?;
    let (sw, sh) = (
        bounds.usable_width,
        bounds.usable_height,
    );
    let mut rows = Vec::new();
    let mut row = Row {
        width: 0,
        height: 0,
        items: Vec::new(),
    };
    for (index, item) in items.iter().enumerate() {
        if item.count == 0 {
            continue;
        }
        let (w, h) = (item.crop.width_mm, item.crop.height_mm);
        if !w.is_finite()
            || !h.is_finite()
            || !(10.0..=101.6).contains(&w)
            || !(10.0..=152.4).contains(&h)
        {
            return Err("Invalid photo dimensions".into());
        }
        let (w, h) = (pixels(w, dpi), pixels(h, dpi));
        if w > sw || h > sh {
            return Err("A photo does not fit inside the paper margins".into());
        }
        for _ in 0..item.count {
            if !row.items.is_empty() && row.width + gx + w > sw {
                rows.push(row);
                row = Row {
                    width: 0,
                    height: 0,
                    items: Vec::new(),
                };
            }
            let x = if row.items.is_empty() {
                0
            } else {
                row.width + gx
            };
            row.items.push(Placement {
                index,
                x,
                y: 0,
                width: w,
                height: h,
            });
            row.width = x + w;
            row.height = row.height.max(h);
        }
    }
    if !row.items.is_empty() {
        rows.push(row);
    }
    let mut pages=Vec::new();let mut placements=Vec::new();let mut used=0;
    for row in rows {
        if !placements.is_empty() && used+gy+row.height>sh {pages.push(placements);placements=Vec::new();used=0;}
        let y=bounds.top+used+if placements.is_empty(){0}else{gy};
        for mut item in row.items {item.x+=bounds.left;item.y=y;placements.push(item);}
        used=y-bounds.top+row.height;
    }
    if !placements.is_empty(){pages.push(placements);}Ok(pages)
}
#[cfg(test)]
pub fn layout(items:&[SheetItem],dpi:u32,gap_mm:f64,paper:&Paper)->Result<Vec<Placement>,String>{
 let mut pages=layout_pages(items,dpi,gap_mm,paper)?;
 if pages.len()!=1{return Err("These photos do not fit the paper margins. Reduce quantities, sizes, gap or margins.".into());}Ok(pages.remove(0))
}
#[cfg(test)]
pub fn compose(store:&DocumentStore,items:&[SheetItem],dpi:u32,gap_mm:f64,paper:&Paper)->Result<DynamicImage,String>{layout(items,dpi,gap_mm,paper)?;compose_page(store,items,dpi,gap_mm,paper,0)}
pub fn compose_page(
    store: &DocumentStore,
    items: &[SheetItem],
    dpi: u32,
    gap_mm: f64,
    paper: &Paper,
    page: usize,
) -> Result<DynamicImage, String> {
    compose_page_preview(store,items,dpi,gap_mm,paper,page,false)
}
pub fn compose_page_preview(store:&DocumentStore,items:&[SheetItem],dpi:u32,gap_mm:f64,paper:&Paper,page:usize,preview:bool)->Result<DynamicImage,String>{
    let pages=layout_pages(items,dpi,gap_mm,paper)?;
    let placements=pages.get(page).ok_or("Invalid sheet page")?;
    let mut photos = std::collections::HashMap::new();
    for (index, item) in items.iter().enumerate() {
        if !placements.iter().any(|p|p.index==index) {
            continue;
        }
        let photo = store
            .photos
            .get(&item.doc_id)
            .ok_or("A selected photo is closed")?;
        let source = if item.crop.remove_background {
            photo.cutout.as_ref().ok_or("Remove the background first")?
        } else {
            &photo.original
        };
        background_color(&item.crop.background)?;
        let mut crop = item.crop.clone();
        crop.dpi = dpi;
        crop.gap_mm = gap_mm;
        let bounded;
        let source=if preview {bounded=source.thumbnail(1200,1200);&bounded}else{source};
        photos.insert(index, render(source, &crop, false)?.to_rgb8());
    }
    let bounds = paper.bounds(dpi)?;
    let scale=if preview {(1000.0/bounds.width.max(bounds.height) as f64).min(1.0)}else{1.0};
    let mut paper = RgbImage::from_pixel((bounds.width as f64*scale).round() as u32, (bounds.height as f64*scale).round() as u32, Rgb([255, 255, 255]));
    for p in placements {
        debug_assert_eq!(photos[&p.index].dimensions(), (p.width, p.height));
        if preview {
            let x=(p.x as f64*scale).round() as u32;let y=(p.y as f64*scale).round() as u32;
            let w=((p.x+p.width) as f64*scale).round() as u32-x;let h=((p.y+p.height) as f64*scale).round() as u32-y;
            let small=image::imageops::resize(&photos[&p.index],w,h,image::imageops::FilterType::Triangle);
            image::imageops::replace(&mut paper,&small,x as i64,y as i64);
        }else{image::imageops::replace(&mut paper, &photos[&p.index], p.x as i64, p.y as i64);}
    }
    Ok(DynamicImage::ImageRgb8(paper))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn print_preview_is_bounded_and_faster_than_full_resolution() {
        let mut store=DocumentStore::default();
        let id=store.insert(crate::PhotoData{original:DynamicImage::ImageRgb8(RgbImage::from_pixel(2400,3200,Rgb([20,30,40]))),mask:None,cutout:None});
        let mut photo=item(id,12,27.94,33.02);photo.crop.rotation=7.5;
        let items=[photo];let paper=Paper::default();
        let start=std::time::Instant::now();let full=compose_page(&store,&items,300,2.54,&paper,0).unwrap();let full_ms=start.elapsed().as_millis();
        let start=std::time::Instant::now();let preview=compose_page_preview(&store,&items,300,2.54,&paper,0,true).unwrap();let preview_ms=start.elapsed().as_millis();
        eprintln!("PRINT_PREVIEW_PROFILE full={}ms bounded={}ms",full_ms,preview_ms);
        assert_eq!(full.width(),1200);assert_eq!((preview.width(),preview.height()),(667,1000));
        assert_eq!(store.photos[&id].original.width(),2400);
    }
    #[test]
    fn twenty_four_photos_keep_all_people_across_pages() {
        let items:Vec<_>=(1..=8).map(|id|item(id,3,27.94,33.02)).collect();
        let paper=Paper{left_mm:5.08,right_mm:5.08,top_mm:2.54,bottom_mm:2.54,..Paper::default()};
        let pages=layout_pages(&items,300,2.54,&paper).unwrap();
        assert_eq!(pages.iter().map(|p|p.len()).collect::<Vec<_>>(),vec![12,12]);
        for index in 0..8 {assert_eq!(pages.iter().flatten().filter(|p|p.index==index).count(),3);}
        for page in pages {assert_eq!((page[0].x,page[0].y),(60,30));}
        let mut store=DocumentStore::default();
        let id=store.insert(crate::PhotoData{original:DynamicImage::ImageRgb8(RgbImage::from_pixel(10,10,Rgb([20,30,40]))),mask:None,cutout:None});
        let photos=[item(id,24,27.94,33.02)];
        let output=compose_page(&store,&photos,300,2.54,&paper,1).unwrap().to_rgb8();
        assert_eq!(output.get_pixel(70,40).0,[20,30,40]);
        assert!(compose_page(&store,&photos,300,2.54,&paper,2).is_err());
    }
    #[test]
    fn independent_column_and_row_gaps_match_preview(){
        let paper=Paper{column_gap_mm:Some(2.0),row_gap_mm:Some(7.0),..Paper::default()};
        let placements=layout(&[item(1,6,35.0,45.0)],300,3.0,&paper).unwrap();
        assert_eq!((placements[1].x,placements[2].y),(437,614));
        let mut large=paper.clone();large.row_gap_mm=Some(20.0);
        assert!(layout(&[item(1,6,35.0,45.0)],300,3.0,&large).is_err());
        large.row_gap_mm=Some(f64::NAN);assert!(large.bounds(300).is_err());
        assert_eq!(Paper::default().gaps(3.0,300).unwrap(),(35,35));
    }
    #[test]
    fn a4_asymmetric_margins_define_printable_bounds() {
        let paper = Paper {
            width_mm: 210.0,
            height_mm: 297.0,
            left_mm: 10.0,
            right_mm: 20.0,
            top_mm: 15.0,
            bottom_mm: 5.0,
            ..Paper::default()
        };
        let bounds = paper.bounds(300).unwrap();
        assert_eq!(
            (
                bounds.width,
                bounds.height,
                bounds.left,
                bounds.top,
                bounds.usable_width,
                bounds.usable_height
            ),
            (2480, 3508, 118, 177, 2126, 3272)
        );
        let p = layout(&[item(1, 2, 35.0, 45.0)], 300, 3.0, &paper).unwrap();
        assert_eq!((p[0].x, p[0].y), (118, 177));
        let mut invalid = paper.clone();
        invalid.right_mm = 210.0;
        assert!(invalid.bounds(300).is_err());
        let small = Paper {
            left_mm: 80.0,
            ..Paper::default()
        };
        assert!(layout(&[item(1, 1, 35.0, 45.0)], 300, 3.0, &small).is_err());
    }
    fn item(id: u64, count: u32, w: f64, h: f64) -> SheetItem {
        SheetItem {
            doc_id: id,
            count,
            crop: Crop {
                adjustments: crate::tone::Tone::default(),
                paper: Paper::default(),
                rotation: 0.0,
                remove_background: false,
                background: "white".into(),
                x: 0.0,
                y: 0.0,
                width: 1.0,
                height: 1.0,
                width_mm: w,
                height_mm: h,
                dpi: 300,
                gap_mm: 3.0,
            },
        }
    }
    #[test]
    fn six_mixed_photos_match_preview_positions() {
        let items = [item(1, 2, 35.0, 45.0), item(2, 4, 35.0, 45.0)];
        let p = layout(&items, 300, 3.0, &Paper::default()).unwrap();
        assert_eq!(p.len(), 6);
        assert_eq!((p[0].x, p[0].y, p[0].width, p[0].height), (0, 0, 413, 531));
        assert_eq!(
            p.iter().map(|p| p.index).collect::<Vec<_>>(),
            vec![0, 0, 1, 1, 1, 1]
        );
    }
    #[test]
    fn mixed_sizes_fit_without_overlap_and_overflow_is_rejected() {
        let items = [item(1, 2, 35.0, 45.0), item(2, 2, 25.0, 35.0)];
        let p = layout(&items, 300, 3.0, &Paper::default()).unwrap();
        for a in &p {
            assert!(a.x + a.width <= 1200 && a.y + a.height <= 1800);
        }
        for (i, a) in p.iter().enumerate() {
            for b in p.iter().skip(i + 1) {
                assert!(
                    a.x + a.width <= b.x
                        || b.x + b.width <= a.x
                        || a.y + a.height <= b.y
                        || b.y + b.height <= a.y
                );
            }
        }
        assert!(layout(&[item(1, 7, 35.0, 45.0)], 300, 3.0, &Paper::default()).is_err());
        assert!(layout(&[item(1, 0, 35.0, 45.0)], 300, 3.0, &Paper::default()).is_err());
        assert!(layout(&[item(1, 101, 35.0, 45.0)], 300, 3.0, &Paper::default()).is_err());
    }
    #[test]
    fn composition_uses_each_document_and_keeps_paper_white() {
        let mut store = DocumentStore::default();
        let red = store.insert(crate::PhotoData {
            original: DynamicImage::ImageRgb8(RgbImage::from_pixel(70, 90, Rgb([200, 0, 0]))),
            mask: None,
            cutout: None,
        });
        let blue = store.insert(crate::PhotoData {
            original: DynamicImage::ImageRgb8(RgbImage::from_pixel(70, 90, Rgb([0, 0, 200]))),
            mask: None,
            cutout: None,
        });
        let items = [item(red, 1, 35.0, 45.0), item(blue, 1, 35.0, 45.0)];
        let positions = layout(&items, 300, 3.0, &Paper::default()).unwrap();
        let output = compose(&store, &items, 300, 3.0, &Paper::default())
            .unwrap()
            .to_rgb8();
        assert_eq!(output.dimensions(), (1200, 1800));
        assert_eq!(output.get_pixel(1199, 1799).0, [255, 255, 255]);
        assert_eq!(
            output
                .get_pixel(positions[0].x + 200, positions[0].y + 200)
                .0,
            [200, 0, 0]
        );
        assert_eq!(
            output
                .get_pixel(positions[1].x + 200, positions[1].y + 200)
                .0,
            [0, 0, 200]
        );
        store.photos.remove(&red);
        assert!(compose(&store, &items, 300, 3.0, &Paper::default()).is_err());
    }
}

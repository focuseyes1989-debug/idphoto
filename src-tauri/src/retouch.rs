pub fn apply(image:&mut image::RgbaImage,strength:f64)->Result<(),String>{
 if !strength.is_finite()||!(0.0..=100.0).contains(&strength){return Err("Retouch strength must be 0 to 100".into());}
 if strength==0.0{return Ok(());}
 let source=image.clone();let (width,height)=source.dimensions();let step=((width.min(height) as f64/600.0).round() as i32).max(1);
 for y in 0..height {for x in 0..width {
 let p=source.get_pixel(x,y);let r=p[0] as f64;let g=p[1] as f64;let b=p[2] as f64;
 let cb=128.0-0.168736*r-0.331264*g+0.5*b;let cr=128.0+0.5*r-0.418688*g-0.081312*b;
 let skin=1.0_f64.min((cb-75.0)/10.0).min((130.0-cb)/10.0).min((cr-130.0)/10.0).min((175.0-cr)/10.0).min((r-35.0)/20.0).max(0.0);
 if skin==0.0||p[3]==0{continue;}
 let mut sum=[0.0;3];let mut weight=0.0;
 for dy in -2..=2 {for dx in -2..=2 {
 let xx=x as i32+dx*step;let yy=y as i32+dy*step;if xx<0||yy<0||xx>=width as i32||yy>=height as i32{continue;}
 let q=source.get_pixel(xx as u32,yy as u32);if q[3]!=p[3]{continue;}
 let distance=(r-q[0] as f64).powi(2)+(g-q[1] as f64).powi(2)+(b-q[2] as f64).powi(2);if distance>=1200.0{continue;}
 let w=(1.0-distance/1200.0)/(1+dx*dx+dy*dy) as f64;weight+=w;for c in 0..3{sum[c]+=w*q[c] as f64;}
 }}
 let out=image.get_pixel_mut(x,y);for c in 0..3{out[c]=(p[c] as f64+(sum[c]/weight-p[c] as f64)*skin*strength/100.0*0.65).round() as u8;}
 }}Ok(())
}

#[cfg(test)]
mod tests {
 use super::*;
 #[test]
 fn smoothing_keeps_geometry_transparency_and_edges(){
 let mut image=image::RgbaImage::from_pixel(9,9,image::Rgba([210,160,130,255]));
 image.put_pixel(4,4,image::Rgba([198,148,118,255]));image.put_pixel(0,0,image::Rgba([0,0,0,255]));image.put_pixel(1,0,image::Rgba([0,110,230,255]));image.put_pixel(2,0,image::Rgba([210,160,130,0]));
 let original=image.clone();apply(&mut image,0.0).unwrap();assert_eq!(image,original);
 let mut low=image.clone();apply(&mut low,20.0).unwrap();apply(&mut image,100.0).unwrap();
 assert!(image.get_pixel(4,4)[0]>low.get_pixel(4,4)[0]);assert!(low.get_pixel(4,4)[0]>198);
 for x in 0..3{assert_eq!(image.get_pixel(x,0),original.get_pixel(x,0));}
 assert_eq!(image.as_raw().iter().enumerate().map(|(i,v)|(i as u64+1)*(*v as u64)).sum::<u64>(),9934394);
 assert_eq!(image.dimensions(),(9,9));assert!(apply(&mut image,101.0).is_err());
 let tone=crate::tone::Tone{retouch:55.0,..Default::default()};
 assert_ne!(tone.apply(image::DynamicImage::ImageRgba8(original.clone())).unwrap().to_rgba8(),original);
 }
}

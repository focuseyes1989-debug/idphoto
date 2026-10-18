use serde::Deserialize;
#[derive(Clone,Deserialize)]
pub struct Stroke{pub kind:String,pub radius:f64,pub strength:f64,pub points:Vec<[f64;2]>}
pub fn validate(strokes:&[Stroke])->Result<(),String>{
 if strokes.len()>500||strokes.iter().map(|s|s.points.len()).sum::<usize>()>10000||strokes.iter().any(|s|!matches!(s.kind.as_str(),"Blur"|"Sharpen"|"Smudge")||!s.radius.is_finite()||s.radius<=0.0||s.radius>4.0||!s.strength.is_finite()||!(0.0..=1.0).contains(&s.strength)||s.points.is_empty()||s.points.iter().flatten().any(|n|!n.is_finite()||!(0.0..=1.0).contains(n))){return Err("Invalid brush strokes".into());}Ok(())
}
pub fn apply(image:&image::DynamicImage,strokes:&[Stroke])->Result<image::DynamicImage,String>{
 validate(strokes)?;if strokes.is_empty(){return Ok(image.clone());}let mut out=image.to_rgba8();let(w,h)=out.dimensions();let size=w.max(h) as f64;
 for s in strokes{let mut last=s.points[0];if s.kind!="Smudge"{dab(&mut out,s,last[0]*w as f64,last[1]*h as f64,0.0,0.0);}
 for p in s.points.iter().skip(1){let dx=(p[0]-last[0])*w as f64;let dy=(p[1]-last[1])*h as f64;let n=(dx.hypot(dy)/(s.radius*size*0.35).max(1.0)).ceil().max(1.0) as usize;
 for i in 1..=n{dab(&mut out,s,last[0]*w as f64+dx*i as f64/n as f64,last[1]*h as f64+dy*i as f64/n as f64,dx/n as f64,dy/n as f64);}last=*p;
 }}Ok(image::DynamicImage::ImageRgba8(out))
}
fn dab(out:&mut image::RgbaImage,s:&Stroke,x:f64,y:f64,dx:f64,dy:f64){
 let(w,h)=out.dimensions();let radius=(s.radius*w.max(h) as f64).max(1.0);let step=(radius*0.15).round().max(1.0) as i32;let ox=(x-radius-dx.abs()-step as f64-2.0).floor().max(0.0) as u32;let oy=(y-radius-dy.abs()-step as f64-2.0).floor().max(0.0) as u32;
 let ex=(x+radius+dx.abs()+step as f64+3.0).ceil().min(w as f64) as u32;let ey=(y+radius+dy.abs()+step as f64+3.0).ceil().min(h as f64) as u32;
 let source=image::imageops::crop_imm(out,ox,oy,ex-ox,ey-oy).to_image();
 let left=(x-radius).floor().max(0.0) as u32;let right=(x+radius).ceil().min((w-1) as f64) as u32;let top=(y-radius).floor().max(0.0) as u32;let bottom=(y+radius).ceil().min((h-1) as f64) as u32;
 for yy in top..=bottom{for xx in left..=right{let d=(xx as f64-x).hypot(yy as f64-y)/radius;if d>=1.0{continue;}let p=source.get_pixel(xx-ox,yy-oy);if p[3]==0{continue;}let weight=(1.0-d*d)*s.strength;let pixel=out.get_pixel_mut(xx,yy);
 if s.kind=="Smudge"{let sx=(xx as f64-dx).round().clamp(0.0,(w-1) as f64) as u32;let sy=(yy as f64-dy).round().clamp(0.0,(h-1) as f64) as u32;let q=source.get_pixel(sx-ox,sy-oy);for c in 0..3{pixel[c]=(p[c] as f64+(q[c] as f64-p[c] as f64)*weight*q[3] as f64/255.0).round() as u8;}}
 else{let mut sum=[0.0;3];let mut count=0.0;for j in -1..=1{for i in -1..=1{let sx=(xx as i32+i*step).clamp(0,w as i32-1) as u32;let sy=(yy as i32+j*step).clamp(0,h as i32-1) as u32;let q=source.get_pixel(sx-ox,sy-oy);if q[3]==0{continue;}count+=1.0;for c in 0..3{sum[c]+=q[c] as f64;}}}for c in 0..3{let delta=sum[c]/count-p[c] as f64;pixel[c]=(p[c] as f64+delta*weight*if s.kind=="Sharpen"{-1.0}else{1.0}).round().clamp(0.0,255.0) as u8;}}
 }}
}

#[cfg(test)]
mod tests{
 use super::*;
 #[test]
 fn brush_outputs_match_preview_and_keep_unpainted_pixels(){
 let mut image=image::RgbaImage::new(20,20);for y in 0..20{for x in 0..20{image.put_pixel(x,y,image::Rgba([if x<10{50}else{200},100,100,255]));}}
 let original=image::DynamicImage::ImageRgba8(image);
 for (kind,checksum) in [("Blur",186313631_u64),("Sharpen",186297549),("Smudge",184877122)]{
 let stroke=Stroke{kind:kind.into(),radius:0.2,strength:0.8,points:vec![[0.45,0.5],[0.6,0.5]]};
 let output=apply(&original,&[stroke]).unwrap().to_rgba8();assert_eq!(output.dimensions(),(20,20));
 assert_eq!(output.as_raw().iter().enumerate().map(|(i,v)|(i as u64+1)*(*v as u64)).sum::<u64>(),checksum);
 assert_eq!(output.get_pixel(0,0).0,[50,100,100,255]);assert!(output.pixels().all(|p|p[3]==255));
 }
 let bad=Stroke{kind:"Blur".into(),radius:f64::NAN,strength:0.5,points:vec![[0.5,0.5]]};assert!(apply(&original,&[bad]).is_err());
 }
}
